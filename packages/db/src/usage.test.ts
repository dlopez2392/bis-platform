import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordUsage, reportableFrom, listBilledUsageAccounts, listReportableUsage, staleUsageAccountIds, usageRangeFilter,
  USAGE_REPORT_WINDOW_MS, USAGE_STALE_AFTER_MS, type BilledUsageAccount, type UsageInput,
} from "./usage";

/**
 * usage.ts without a database: the guards that must fire BEFORE a query, the
 * exact insert shape, the window arithmetic, the paging, the per-account
 * filter string and the batching of the reads. The live behaviour is
 * ./test/usage.test.ts. (Like every db-package test, this file runs only
 * where the env names a non-production project: CI.)
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-25T15:00:00.000Z");
const billed = (accountId: string): BilledUsageAccount => ({
  accountId, stripeCustomerId: `cus_${accountId}`, billingStartedAt: "2026-09-20T00:00:00+00:00",
});
const dbRow = (id: string, accountId: string, occurredAt: string) => ({
  id, account_id: accountId, meter: "sms", quantity: 1, occurred_at: occurredAt,
  source_ref: `message:${id}`, reported_at: null, created_at: occurredAt,
});
const untouchable = {
  from: () => { throw new Error("the database was reached"); },
} as unknown as SupabaseClient;
const OK: UsageInput = {
  accountId: "acct_1", meter: "sms", quantity: 2,
  occurredAt: new Date("2026-09-25T14:00:00Z"), sourceRef: "message:m_1",
};

describe("recordUsage — refused before the database", () => {
  it("refuses a quantity that is not a positive whole number (mutation: drop the quantity guard → the stub's 'database was reached' is thrown instead, FAILS)", async () => {
    for (const quantity of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(recordUsage(untouchable, { ...OK, quantity })).rejects.toThrow(/quantity/);
    }
  });

  it("refuses a source that is not its meter's, an empty id, one past 200 characters, and an invalid date (mutation: drop the prefix check → FAILS)", async () => {
    await expect(recordUsage(untouchable, { ...OK, meter: "voice_minutes", sourceRef: "message:m_1" })).rejects.toThrow(/source_ref/);
    await expect(recordUsage(untouchable, { ...OK, sourceRef: "message:" })).rejects.toThrow(/source_ref/);
    await expect(recordUsage(untouchable, { ...OK, sourceRef: `message:${"x".repeat(200)}` })).rejects.toThrow(/source_ref/);
    await expect(recordUsage(untouchable, { ...OK, occurredAt: new Date("not a date") })).rejects.toThrow(/occurredAt/);
  });
});

describe("recordUsage — the insert", () => {
  it("inserts ON CONFLICT (meter, source_ref) DO NOTHING, never an update, every column mapped (mutation: onConflict 'source_ref' → FAILS; ignoreDuplicates false → FAILS)", async () => {
    const seen: unknown[] = [];
    const db = {
      from: (table: string) => ({
        upsert: (row: unknown, opts: unknown) => {
          seen.push(table, row, opts);
          return { select: async () => ({ data: [{ id: "u_1" }], error: null }) };
        },
      }),
    } as unknown as SupabaseClient;
    expect(await recordUsage(db, OK)).toBe("recorded");
    expect(seen).toEqual([
      "usage_events",
      { account_id: "acct_1", meter: "sms", quantity: 2, occurred_at: "2026-09-25T14:00:00.000Z", source_ref: "message:m_1" },
      { onConflict: "meter,source_ref", ignoreDuplicates: true },
    ]);
  });
});

describe("the reporting window", () => {
  it("reportableFrom: a billing start inside the window passes through untouched, microseconds and all; an older one is floored at now − 34 days (mutation: always return the window → FAILS; re-serialise the start through new Date() → the microseconds are lost, FAILS)", () => {
    const now = new Date("2026-09-25T15:00:00.000Z");
    expect(reportableFrom("2026-09-20T10:00:00.123456+00:00", now)).toBe("2026-09-20T10:00:00.123456+00:00");
    expect(reportableFrom("2026-06-01T00:00:00+00:00", now)).toBe("2026-08-22T15:00:00.000Z");
  });

  it("pins the window at 34 days, a day inside Stripe's 35 because a too-old event is dropped without an error, and the stale alarm at 24 hours (mutation: 35 days → FAILS)", () => {
    expect(USAGE_REPORT_WINDOW_MS).toBe(34 * DAY);
    expect(USAGE_STALE_AFTER_MS).toBe(DAY);
  });
});

describe("listBilledUsageAccounts — paging", () => {
  it("reads past PostgREST's 1,000-row page (mutation: a single request → 1,000 accounts, FAILS)", async () => {
    const ranges: [number, number][] = [];
    const page = (n: number, offset: number) => Array.from({ length: n }, (_, i) => ({
      account_id: `acct_${offset + i}`, stripe_customer_id: `cus_${offset + i}`, created_at: "2026-09-01T00:00:00+00:00",
    }));
    const pages = [page(1000, 0), page(2, 1000)];
    const chain = {
      select: () => chain, not: () => chain, order: () => chain,
      range: async (a: number, b: number) => {
        ranges.push([a, b]);
        return { data: pages[ranges.length - 1] ?? [], error: null };
      },
    };
    const db = { from: () => chain } as unknown as SupabaseClient;
    const got = await listBilledUsageAccounts(db);
    expect(got).toHaveLength(1002);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(got[1001]).toEqual({ accountId: "acct_1001", stripeCustomerId: "cus_1001", billingStartedAt: "2026-09-01T00:00:00+00:00" });
  });
});

describe("the per-account reads: bounded, one request per 50 accounts", () => {
  it("usageRangeFilter: one and() per account with ITS OWN range, every timestamp double-quoted (mutation: unquoted timestamps → PostgREST splits the value on '.', FAILS; one shared floor for every account → FAILS)", () => {
    expect(usageRangeFilter([
      { accountId: "a1", fromIso: "2026-09-20T10:00:00.123456+00:00" },
      { accountId: "a2", fromIso: "2026-08-22T15:00:00.000Z", beforeIso: "2026-08-23T15:00:00.000Z" },
    ])).toBe(
      'and(account_id.eq.a1,occurred_at.gte."2026-09-20T10:00:00.123456+00:00"),'
      + 'and(account_id.eq.a2,occurred_at.gte."2026-08-22T15:00:00.000Z",occurred_at.lt."2026-08-23T15:00:00.000Z")',
    );
  });

  it("listReportableUsage reads 50 accounts at a time and merges the reads OLDEST FIRST across accounts, at most `limit` (mutation: concatenate the reads in read order → FAILS; one read naming all 120 accounts → FAILS)", async () => {
    const accounts = Array.from({ length: 120 }, (_, i) => billed(`acct_${i}`));
    const filters: string[] = [];
    const perRead = [
      [dbRow("u_late", "acct_0", "2026-09-25T12:00:00+00:00")],
      [dbRow("u_early", "acct_60", "2026-09-24T12:00:00+00:00")],
      [dbRow("u_mid", "acct_110", "2026-09-25T01:00:00+00:00")],
    ];
    const chain = {
      select: () => chain, is: () => chain, order: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: perRead[filters.length - 1] ?? [], error: null }),
    };
    const rows = await listReportableUsage({ from: () => chain } as unknown as SupabaseClient, accounts, NOW, 2);
    expect(filters.map((f) => f.split("and(").length - 1)).toEqual([50, 50, 20]);
    expect(rows.map((r) => r.id)).toEqual(["u_early", "u_mid"]);
  });

  it("staleUsageAccountIds: a FULL read (one account's backlog) is followed by a read of only the accounts it did not name, until a read comes back short (mutation: stop after the first read → acct_2 missed, FAILS; re-read every account → the second filter still names acct_1, FAILS)", async () => {
    const accounts = ["acct_1", "acct_2", "acct_3"].map(billed);
    const filters: string[] = [];
    const reads = [Array.from({ length: 1000 }, () => ({ account_id: "acct_1" })), [{ account_id: "acct_2" }]];
    const chain = {
      select: () => chain, is: () => chain, lt: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: reads[filters.length - 1] ?? [], error: null }),
    };
    expect(await staleUsageAccountIds({ from: () => chain } as unknown as SupabaseClient, accounts, NOW))
      .toEqual(["acct_1", "acct_2"]);
    expect(filters).toHaveLength(2);
    expect(filters[1]).not.toContain("acct_1");
    expect(filters[1]).toContain("acct_2");
    expect(filters[1]).toContain("acct_3");
  });
});
