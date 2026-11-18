import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkinCounts } from "./job-checkins";

/**
 * F-072 PR 4 (plan D8): the settings card's counts equal the rows. An in-memory table that APPLIES the filters
 * checkinCounts asks for (eq, gte), so the numbers come from seeded rows and not from a canned answer. The real
 * queries are proven against PostgREST in test/job-checkins.test.ts ("stamps the first press only, and counts ...").
 */
type Row = Record<string, string | null>;
function memoryDb(tables: Record<string, Row[]>, fail: string | null = null): SupabaseClient {
  const chainFor = (table: string): unknown => {
    const filters: ((r: Row) => boolean)[] = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, v: string) => { filters.push((r) => r[col] === v); return chain; },
      // PostgREST's gte on a null column is false, as a null never compares.
      gte: (col: string, v: string) => { filters.push((r) => r[col] != null && r[col]! >= v); return chain; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (fail === table) return Promise.resolve({ count: null, error: { message: "down" } }).then(res, rej);
        return Promise.resolve({ count: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).length, error: null }).then(res, rej);
      },
    };
    return chain;
  };
  return { from: (t: string) => chainFor(t) } as unknown as SupabaseClient;
}

const ACCT = "a1";
const SINCE = "2026-10-01T00:00:00.000Z";
const checkinRow = (answer: string, answeredAt: string, opened: string | null, account = ACCT): Row =>
  ({ account_id: account, answer, answered_at: answeredAt, review_link_opened_at: opened });

describe("checkinCounts equals the seeded rows (plan D8)", () => {
  const tables = {
    bookings: [
      { account_id: ACCT, review_requested_at: "2026-10-05T10:00:00Z" }, { account_id: ACCT, review_requested_at: "2026-10-06T10:00:00Z" },
      { account_id: ACCT, review_requested_at: "2026-10-07T10:00:00Z" }, { account_id: ACCT, review_requested_at: "2026-10-08T10:00:00Z" },
      { account_id: ACCT, review_requested_at: "2026-08-01T10:00:00Z" },   // before the floor
      { account_id: ACCT, review_requested_at: null },                      // never asked
      { account_id: "other", review_requested_at: "2026-10-05T10:00:00Z" }, // another account
    ],
    job_checkins: [
      checkinRow("great", "2026-10-05T12:00:00Z", "2026-10-05T12:05:00Z"),
      checkinRow("okay", "2026-10-06T12:00:00Z", null),            // answered, never pressed the button
      checkinRow("not_great", "2026-10-07T12:00:00Z", null),
      checkinRow("great", "2026-08-02T12:00:00Z", "2026-08-02T12:05:00Z"),   // before the floor
      checkinRow("great", "2026-10-05T12:00:00Z", "2026-10-05T12:05:00Z", "other"),
    ],
  };

  it("counts asked, answered, each answer and opened since the floor, and nobody else's (mutation: opened counts every answer -> FAILS)", async () => {
    expect(await checkinCounts(memoryDb(tables), ACCT, SINCE))
      .toEqual({ asked: 4, answered: 3, great: 1, okay: 1, notGreat: 1, opened: 1 });
  });

  it("a link that was never pressed is not opened: an account whose answers carry no press counts zero opened (mutation: count not-opened as opened -> FAILS)", async () => {
    const none = { ...tables, job_checkins: tables.job_checkins.map((r) => ({ ...r, review_link_opened_at: null })) };
    expect((await checkinCounts(memoryDb(none), ACCT, SINCE)).opened).toBe(0);
  });

  it("an empty account is zeros, not an error", async () => {
    expect(await checkinCounts(memoryDb({}), ACCT, SINCE)).toEqual({ asked: 0, answered: 0, great: 0, okay: 0, notGreat: 0, opened: 0 });
  });

  it("a failed read THROWS, so the card shows its error and never a zero (mutation: default to 0 -> FAILS)", async () => {
    await expect(checkinCounts(memoryDb(tables, "job_checkins"), ACCT, SINCE)).rejects.toThrow(/checkinCounts .* failed: down/);
  });
});
