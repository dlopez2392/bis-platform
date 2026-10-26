import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  saveReconciliation, listReconciliations, latestReconciliations, reconciledSince, reconcileNightStart,
  RECONCILIATION_VERDICTS, ALERTING_VERDICTS, RECONCILE_LOOKBACK_MS,
  type ReconciliationWrite,
} from "./billing-reconciliations";

/**
 * billing-reconciliations.ts without a database. The fake below is a tiny
 * PostgREST over an in-memory table: it APPLIES the filters (eq, in, gt, gte,
 * lt), the ORDER BY clauses in the order the code sends them, and `range`,
 * capped at a server `max_rows`, so a wrong order, a wrong comparison or a
 * paging loop that stops on a short page shows up in the result rather than
 * only in the call log. The live round trip is ./test/billing-pause.test.ts.
 */
const NOW = new Date("2026-10-26T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const uuidFor = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = uuidFor(1);
const B = uuidFor(2);

type Call = [string, ...unknown[]];
type Row = Record<string, unknown>;

const cmp = (x: unknown, y: unknown): number => {
  const dx = typeof x === "string" ? Date.parse(x) : Number.NaN;
  const dy = typeof y === "string" ? Date.parse(y) : Number.NaN;
  if (!Number.isNaN(dx) && !Number.isNaN(dy)) return dx - dy;
  return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
};

function matches(r: Row, c: Call): boolean {
  const [op, col, v] = c as [string, string, unknown];
  switch (op) {
    case "eq": return r[col] === v;
    case "in": return (v as unknown[]).includes(r[col]);
    case "gt": return cmp(r[col], v) > 0;
    case "gte": return cmp(r[col], v) >= 0;
    case "lt": return cmp(r[col], v) < 0;
    default: return true;
  }
}

function tableFake(rows: Row[], maxRows = Infinity) {
  /** Every query that reached `range`, with its calls. */
  const reads: Call[][] = [];
  const upserts: unknown[][] = [];
  const db = {
    from: (table: string) => {
      const calls: Call[] = [];
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "gt", "gte", "lt", "order"]) {
        chain[op] = (...args: unknown[]) => { calls.push([op, ...args]); return chain; };
      }
      chain.upsert = (...args: unknown[]) => { upserts.push([table, ...args]); return Promise.resolve({ error: null }); };
      chain.range = (from: number, to: number) => {
        calls.push(["range", from, to]);
        reads.push(calls);
        const orders = calls.filter((c) => c[0] === "order") as [string, string, { ascending: boolean }][];
        const out = rows.filter((r) => calls.every((c) => matches(r, c))).sort((x, y) => {
          for (const [, col, o] of orders) {
            const d = cmp(x[col], y[col]);
            if (d !== 0) return o.ascending ? d : -d;
          }
          return 0;
        });
        return Promise.resolve({ data: out.slice(from, Math.min(to + 1, from + maxRows)), error: null });
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, reads, upserts };
}

const rec = (accountId: string, meter: string, windowStart: string, over: Row = {}): Row => ({
  account_id: accountId, meter, window_start: windowStart, window_end: "2026-10-26T11:00:00+00:00",
  bis_settled: "10", bis_in_flight: 2, bis_held: 0, stripe_total: "10", verdict: "match",
  checked_at: "2026-10-26T09:00:00+00:00", ...over,
});

describe("the verdicts", () => {
  it("names the six verdicts 0099's CHECK allows and the three a person must look at (mutation: add held_missing to the alerting set → FAILS)", () => {
    expect([...RECONCILIATION_VERDICTS]).toEqual(["match", "held_at_stripe", "held_missing", "stripe_over", "stripe_under", "ambiguous"]);
    expect([...ALERTING_VERDICTS]).toEqual(["stripe_over", "stripe_under", "ambiguous"]);
  });
});

describe("reconcileNightStart", () => {
  it("is the most recent 08:00 UTC at or before the instant: 08:00 itself opens a night, 07:59:59.999 is still the night before (mutation: nights from midnight UTC → FAILS; `>` at the boundary → FAILS)", () => {
    const at = (s: string) => reconcileNightStart(new Date(s)).toISOString();
    expect(at("2026-10-01T08:00:00.000Z")).toBe("2026-10-01T08:00:00.000Z");
    expect(at("2026-10-01T07:59:59.999Z")).toBe("2026-09-30T08:00:00.000Z");
    expect(at("2026-10-01T23:59:59.999Z")).toBe("2026-10-01T08:00:00.000Z");
    expect(at("2026-10-02T00:00:00.000Z")).toBe("2026-10-01T08:00:00.000Z");
    expect(at("1970-01-01T03:00:00.000Z")).toBe("1969-12-31T08:00:00.000Z");
  });
});

describe("saveReconciliation", () => {
  it("saveReconciliation upserts on (account_id, meter, window_start) with every field (mutation: onConflict 'account_id,meter' → FAILS)", async () => {
    const { db, upserts } = tableFake([]);
    const w: ReconciliationWrite = {
      accountId: A, meter: "sms", windowStart: "2026-09-26T00:01:00.000Z", windowEnd: "2026-10-26T11:00:00.000Z",
      bisSettled: 40, bisInFlight: 3, bisHeld: 1, stripeTotal: 41, verdict: "held_at_stripe", checkedAt: NOW.toISOString(),
    };
    await saveReconciliation(db, w);
    expect(upserts).toEqual([[
      "billing_reconciliations",
      {
        account_id: A, meter: "sms", window_start: "2026-09-26T00:01:00.000Z", window_end: "2026-10-26T11:00:00.000Z",
        bis_settled: 40, bis_in_flight: 3, bis_held: 1, stripe_total: 41, verdict: "held_at_stripe", checked_at: NOW.toISOString(),
      },
      { onConflict: "account_id,meter,window_start" },
    ]]);
  });
});

describe("listReconciliations and latestReconciliations", () => {
  it("listReconciliations and latestReconciliations return the newest window_start per meter, numbers parsed (mutation: order ascending → FAILS)", async () => {
    const { db } = tableFake([
      rec(A, "sms", "2026-08-26T00:00:00+00:00", { verdict: "stripe_over" }),
      rec(A, "sms", "2026-09-26T00:00:00+00:00"),
      rec(A, "voice_minutes", "2026-09-26T00:00:00+00:00", { verdict: "stripe_under", stripe_total: "7.5" }),
      rec(B, "sms", "2026-09-26T00:00:00+00:00"),
    ]);
    expect(await listReconciliations(db, A, NOW)).toEqual([
      {
        accountId: A, meter: "sms", windowStart: "2026-09-26T00:00:00+00:00", windowEnd: "2026-10-26T11:00:00+00:00",
        bisSettled: 10, bisInFlight: 2, bisHeld: 0, stripeTotal: 10, verdict: "match", checkedAt: "2026-10-26T09:00:00+00:00",
      },
      {
        accountId: A, meter: "voice_minutes", windowStart: "2026-09-26T00:00:00+00:00", windowEnd: "2026-10-26T11:00:00+00:00",
        bisSettled: 10, bisInFlight: 2, bisHeld: 0, stripeTotal: 7.5, verdict: "stripe_under", checkedAt: "2026-10-26T09:00:00+00:00",
      },
    ]);
    const latest = await latestReconciliations(db, [A, B], NOW);
    expect([...latest.keys()].sort()).toEqual([`${A}:sms`, `${A}:voice_minutes`, `${B}:sms`]);
    expect(latest.get(`${A}:sms`)?.windowStart).toBe("2026-09-26T00:00:00+00:00");
  });

  it("latestReconciliations reads only periods starting within 70 days, pages until an EMPTY page, and splits 120 accounts into three reads (mutation: stop on a short page → FAILS; mutation: one read of every account → FAILS by call count)", async () => {
    expect(RECONCILE_LOOKBACK_MS).toBe(70 * DAY);
    const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
    const accounts = Array.from({ length: 120 }, (_, i) => uuidFor(100 + i));
    const first = accounts[0]!;
    const last = accounts[119]!;
    // max_rows 2: every page is SHORT of the 1,000 asked for while rows remain.
    const { db, reads } = tableFake([
      rec(first, "ai_chats", ago(71)),            // older than the lookback: never read
      rec(first, "sms", ago(10)),
      rec(first, "sms", ago(40)),
      rec(first, "voice_minutes", ago(10)),       // the 3rd row of the group: page 2
      rec(last, "sms", ago(69)),                  // inside the lookback, in the third group
    ], 2);
    const latest = await latestReconciliations(db, accounts, NOW);
    expect([...latest.keys()].sort()).toEqual([`${first}:sms`, `${first}:voice_minutes`, `${last}:sms`].sort());
    expect(latest.get(`${first}:sms`)?.windowStart).toBe(ago(10));
    for (const q of reads) expect(q).toContainEqual(["gte", "window_start", ago(70)]);
    // Each group is read until it comes back empty; the groups are 50, 50 and 20 accounts.
    const groups: number[] = [];
    let prev = "";
    for (const q of reads) {
      const ids = q.find((c) => c[0] === "in")![2] as string[];
      if (ids.join() !== prev) groups.push(ids.length);
      prev = ids.join();
    }
    expect(groups).toEqual([50, 50, 20]);
  });
});

describe("reconciledSince", () => {
  it("reconciledSince keys by account, meter and window start, checked at or after the instant, paging until empty (mutation: gt instead of gte → FAILS)", async () => {
    const since = "2026-10-26T08:00:00.000Z";
    const { db } = tableFake([
      rec(A, "sms", "2026-09-26T00:01:00+00:00", { checked_at: "2026-10-26T08:00:00+00:00" }),       // exactly at the instant
      rec(A, "sms", "2026-08-26T00:01:00+00:00", { checked_at: "2026-10-26T08:30:00.5+00:00" }),
      rec(B, "voice_minutes", "2026-09-26T00:01:00+00:00", { checked_at: "2026-10-26T09:00:00+00:00" }),
      rec(B, "sms", "2026-09-26T00:01:00+00:00", { checked_at: "2026-10-26T07:59:59.999+00:00" }), // the night before
    ], 1);
    const got = await reconciledSince(db, since);
    expect([...got].sort()).toEqual([
      `${A}:sms:${Date.parse("2026-08-26T00:01:00Z")}`,
      `${A}:sms:${Date.parse("2026-09-26T00:01:00Z")}`,
      `${B}:voice_minutes:${Date.parse("2026-09-26T00:01:00Z")}`,
    ]);
  });
});
