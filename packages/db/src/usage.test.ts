import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordUsage, reportableFrom, listBilledUsageAccounts, listReportableUsage, staleUsageAccountIds, usageRangeFilter, sumUsageSince,
  USAGE_REPORT_WINDOW_MS, USAGE_STALE_AFTER_MS, USAGE_FUTURE_GRACE_MS,
  USAGE_ACCOUNTS_PER_READ, USAGE_ACCOUNTS_PER_BOUNDED_READ, STALE_PROBE_ROWS,
  type BilledUsageAccount, type UsageInput,
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
/** A valid-shaped uuid for account `n`, distinct and deterministic, so a
 *  test using dozens of "accounts" doesn't need dozens of randomUUID() calls
 *  and still passes usageRangeFilter's uuid check. */
const uuidFor = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
  it("pages until an EMPTY page, never stopping on one merely SHORTER than the request — a server max_rows below the page size would otherwise make a short-but-nonempty page look like the end and drop every account past it (mutation: stop once a page is shorter than BILLED_PAGE → the third, empty-confirming read never happens, FAILS)", async () => {
    const ranges: [number, number][] = [];
    const page = (n: number, offset: number) => Array.from({ length: n }, (_, i) => ({
      account_id: `acct_${offset + i}`, stripe_customer_id: `cus_${offset + i}`, billing_started_at: "2026-09-01T00:00:00+00:00",
    }));
    // Page 2 is short (2 rows, not 1000) but NOT the end: exactly what a
    // server max_rows cap below the requested 1,000 would produce. Only
    // page 3's genuine emptiness may end the loop.
    const pages = [page(1000, 0), page(2, 1000), [] as ReturnType<typeof page>];
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
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1002, 2001]]);
    expect(got[1001]).toEqual({ accountId: "acct_1001", stripeCustomerId: "cus_1001", billingStartedAt: "2026-09-01T00:00:00+00:00" });
  });
});

describe("usageRangeFilter: the account-id guard", () => {
  it("refuses an account id that is not uuid-shaped, so a value carrying `,`/`(`/`)` can never widen the filter (mutation: drop the uuid check → the malicious id is written straight into an unquoted account_id.eq clause instead of throwing, FAILS)", () => {
    const malicious = "x),account_id.not.is.null,and(account_id.eq.x";
    expect(() => usageRangeFilter([{ accountId: malicious, fromIso: "2026-09-20T10:00:00.000Z" }]))
      .toThrow(/uuid/);
  });

  it("accepts a real uuid, upper or lower case (mutation: reject a valid uuid → FAILS)", () => {
    expect(() => usageRangeFilter([{ accountId: uuidFor(1), fromIso: "2026-09-20T10:00:00.000Z" }])).not.toThrow();
    expect(() => usageRangeFilter([{ accountId: uuidFor(1).toUpperCase(), fromIso: "2026-09-20T10:00:00.000Z" }])).not.toThrow();
  });
});

describe("URL size: the per-account filter must fit in one request", () => {
  it("the shared three-part chunk (USAGE_ACCOUNTS_PER_BOUNDED_READ accounts, 3 filter parts each — a floor AND a ceiling — used by both countExpiredUsage's expired-row window and listReportableUsage's future-grace-bounded range) stays under a safe URL bound at the longest an id and a timestamp can be: a uuid and a microsecond, `+00:00`-suffixed occurred_at (mutation: raise USAGE_ACCOUNTS_PER_BOUNDED_READ to 50 → the same filter shape encodes past 9,000 characters, FAILS)", () => {
    const maxTs = "2026-09-20T10:00:00.123456+00:00";
    const ranges = Array.from({ length: USAGE_ACCOUNTS_PER_BOUNDED_READ }, () => ({
      accountId: randomUUID(), fromIso: maxTs, beforeIso: maxTs,
    }));
    const encoded = encodeURIComponent(usageRangeFilter(ranges));
    expect(encoded.length).toBeLessThan(6000);
  });

  it("listReportableUsage chunks its OWN read (every range it builds carries a beforeIso ceiling, so it is the three-part shape) by USAGE_ACCOUNTS_PER_BOUNDED_READ, not the two-part USAGE_ACCOUNTS_PER_READ — proven by capturing the filter this function itself sends, not just the constant's raw value (mutation: chunk this read by the 50-account USAGE_ACCOUNTS_PER_READ constant → all 50 accounts land in ONE request, whose encoded filter is past 9,000 characters, FAILS)", async () => {
    const maxTs = "2026-09-20T10:00:00.123456+00:00";
    const accounts: BilledUsageAccount[] = Array.from({ length: USAGE_ACCOUNTS_PER_READ }, () => ({
      accountId: randomUUID(), stripeCustomerId: "cus_x", billingStartedAt: maxTs,
    }));
    const filters: string[] = [];
    const chain = {
      select: () => chain, is: () => chain, order: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: [], error: null }),
    };
    await listReportableUsage({ from: () => chain } as unknown as SupabaseClient, accounts, NOW, 10);
    expect(filters).toHaveLength(Math.ceil(USAGE_ACCOUNTS_PER_READ / USAGE_ACCOUNTS_PER_BOUNDED_READ));
    for (const f of filters) expect(encodeURIComponent(f).length).toBeLessThan(6000);
  });
});

describe("the per-account reads: bounded, one request per group of accounts", () => {
  it("usageRangeFilter: one and() per account with ITS OWN range, every timestamp double-quoted — checked by exact string comparison, since PostgREST's own acceptance of the quoted form is proved live, not here (mutation: drop the quotes around a timestamp → the built string no longer matches the expected literal, FAILS; one shared floor for every account → FAILS)", () => {
    expect(usageRangeFilter([
      { accountId: uuidFor(1), fromIso: "2026-09-20T10:00:00.123456+00:00" },
      { accountId: uuidFor(2), fromIso: "2026-08-22T15:00:00.000Z", beforeIso: "2026-08-23T15:00:00.000Z" },
    ])).toBe(
      `and(account_id.eq.${uuidFor(1)},occurred_at.gte."2026-09-20T10:00:00.123456+00:00"),`
      + `and(account_id.eq.${uuidFor(2)},occurred_at.gte."2026-08-22T15:00:00.000Z",occurred_at.lt."2026-08-23T15:00:00.000Z")`,
    );
  });

  it("listReportableUsage reads accounts in groups of USAGE_ACCOUNTS_PER_BOUNDED_READ and merges the reads OLDEST FIRST across accounts, at most `limit` (mutation: concatenate the reads in read order → FAILS; one read naming all 120 accounts → FAILS)", async () => {
    const accounts = Array.from({ length: 120 }, (_, i) => billed(uuidFor(i)));
    const filters: string[] = [];
    // 120 accounts chunked by USAGE_ACCOUNTS_PER_BOUNDED_READ (25) is 5 groups:
    // [0-24],[25-49],[50-74],[75-99],[100-119]. uuidFor(0) lands in group 0,
    // uuidFor(60) in group 2, uuidFor(110) in group 4.
    const perRead = [
      [dbRow("u_late", uuidFor(0), "2026-09-25T12:00:00+00:00")],
      [],
      [dbRow("u_early", uuidFor(60), "2026-09-24T12:00:00+00:00")],
      [],
      [dbRow("u_mid", uuidFor(110), "2026-09-25T01:00:00+00:00")],
    ];
    const chain = {
      select: () => chain, is: () => chain, order: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: perRead[filters.length - 1] ?? [], error: null }),
    };
    const rows = await listReportableUsage({ from: () => chain } as unknown as SupabaseClient, accounts, NOW, 2);
    expect(filters.map((f) => f.split("and(").length - 1)).toEqual([25, 25, 25, 25, 20]);
    expect(rows.map((r) => r.id)).toEqual(["u_early", "u_mid"]);
  });

  it("listReportableUsage's filter caps every account's range at now + 5 minutes, the shared future grace, on top of its own floor (mutation: drop the upper bound → the filter carries no occurred_at.lt clause, FAILS)", async () => {
    const account = billed(uuidFor(1));
    const filters: string[] = [];
    const chain = {
      select: () => chain, is: () => chain, order: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: [], error: null }),
    };
    await listReportableUsage({ from: () => chain } as unknown as SupabaseClient, [account], NOW, 10);
    const until = new Date(NOW.getTime() + USAGE_FUTURE_GRACE_MS).toISOString();
    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain(`occurred_at.lt."${until}"`);
  });

  /**
   * A fake `usage_events` holding stale rows, answering the stale probe the
   * way PostgREST would: only the accounts the `.or()` names, ordered by id,
   * at most `.limit()` rows AND at most the server's `max_rows`. Awaiting the
   * chain without a `.limit()` returns every match (what an unbounded read
   * would), so a missing cap shows up as rows read, not as a crash.
   */
  function staleFake(rows: { id: string; account_id: string }[], maxRows = Infinity) {
    const served: number[] = [];
    const read = (named: Set<string>, limit: number) => {
      const out = rows.filter((r) => named.has(r.account_id))
        .sort((x, y) => (x.id < y.id ? -1 : 1)).slice(0, Math.min(limit, maxRows))
        .map((r) => ({ account_id: r.account_id }));
      served.push(out.length);
      return { data: out, error: null };
    };
    const db = {
      from: () => {
        let named = new Set<string>();
        const chain = {
          select: () => chain, is: () => chain, lt: () => chain, order: () => chain,
          or: (f: string) => { named = new Set([...f.matchAll(/account_id\.eq\.([0-9a-f-]{36})/g)].map((m) => m[1]!)); return chain; },
          limit: async (n: number) => read(named, n),
          then: (ok: (v: unknown) => unknown) => Promise.resolve(read(named, Infinity)).then(ok),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    return { db, served };
  }
  const backlog = (accountId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${accountId}-${String(i).padStart(6, "0")}`, account_id: accountId }));

  it("staleUsageAccountIds reads a number of rows bounded by ACCOUNTS, never by backlog: 8,000 stale rows on two of 60 accounts are found reading at most STALE_PROBE_ROWS × (2 stale accounts + 2 groups) rows (mutation: remove the .limit(STALE_PROBE_ROWS) cap → all 8,000 rows are read, FAILS)", async () => {
    expect(STALE_PROBE_ROWS).toBe(50);
    const accounts = Array.from({ length: 60 }, (_, i) => billed(uuidFor(i)));
    const { db, served } = staleFake([...backlog(uuidFor(1), 5000), ...backlog(uuidFor(55), 3000)]);
    const ids = await staleUsageAccountIds(db, accounts, NOW);
    expect(ids).toEqual([uuidFor(1), uuidFor(55)]);
    const read = served.reduce((a, b) => a + b, 0);
    expect(read).toBeLessThanOrEqual(STALE_PROBE_ROWS * (2 + 2));
    // Two groups of USAGE_ACCOUNTS_PER_READ: each reads once per stale
    // account it holds, then once more to come back empty.
    expect(served).toEqual([STALE_PROBE_ROWS, 0, STALE_PROBE_ROWS, 0]);
  });

  it("staleUsageAccountIds ends a group only on an EMPTY read, never a SHORT one — a server max_rows below STALE_PROBE_ROWS makes every read short while accounts are still unread (mutation: stop once a read is shorter than STALE_PROBE_ROWS → only the first account is found, FAILS)", async () => {
    const accounts = [uuidFor(1), uuidFor(2), uuidFor(3)].map(billed);
    const { db, served } = staleFake([...backlog(uuidFor(1), 40), ...backlog(uuidFor(3), 2)], 1);
    const ids = await staleUsageAccountIds(db, accounts, NOW);
    expect(ids).toEqual([uuidFor(1), uuidFor(3)]);
    expect(served).toEqual([1, 1, 0]);
  });
});

describe("sumUsageSince", () => {
  it("sums each meter over EVERY page of the account's rows since the instant, paging until an empty page (mutation: stop after the first page → the second page's 2 texts are lost, FAILS; drop the account filter → FAILS)", async () => {
    const eqs: unknown[][] = [];
    const ranges: [number, number][] = [];
    const pages = [
      [{ meter: "voice_minutes", quantity: 3 }, { meter: "sms", quantity: 1 }],
      [{ meter: "sms", quantity: 2 }, { meter: "ai_chats", quantity: 1 }],
      [],
    ];
    const chain = {
      select: () => chain, order: () => chain,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
      gte: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
      range: async (a: number, b: number) => { ranges.push([a, b]); return { data: pages[ranges.length - 1] ?? [], error: null }; },
    };
    const got = await sumUsageSince({ from: () => chain } as unknown as SupabaseClient, "acct_1", "2026-10-01T00:00:00.000Z");
    expect(got).toEqual({ voice_minutes: 3, sms: 3, ai_chats: 1 });
    expect(eqs).toContainEqual(["account_id", "acct_1"]);
    expect(eqs).toContainEqual(["occurred_at", "2026-10-01T00:00:00.000Z"]);
    expect(ranges).toEqual([[0, 999], [2, 1001], [4, 1003]]);
  });
});
