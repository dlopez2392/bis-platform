import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rescheduleRoots, listFeedBookings, FEED_FUTURE_CAP } from "../booking";
import {
  readLiveCalendarFeed, revokeCalendarFeed, replaceCalendarFeed, restoreCalendarFeed, claimCalendarFeedFetch,
  CALENDAR_FEED_FETCH_MAX, CALENDAR_FEED_FETCH_WINDOW_SECONDS, CALENDAR_FEED_UNDO_SECONDS,
} from "../calendar-feeds";

/**
 * F-048 part 2: the reads behind a person's calendar feed. No real database: a fake client that records
 * every table, select and filter, so a read that loses its account scope, its status list or a
 * Technician's fence fails here by name. The live end-to-end cases are calendar-feeds.test.ts (CI only).
 */
type Call = { table: string; filters: [string, string, unknown][]; cols: string };
/** Answers bookings by id from `byId` (for the chain walk) and the window from `window`. */
function fake(o: { byId?: Record<string, { id: string; rescheduled_from_id: string | null; account_id: string }>; window?: unknown[]; calendar?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [], cols: "" };
      calls.push(call);
      const b: Record<string, unknown> = {};
      const add = (op: string) => (col: string, v: unknown) => { call.filters.push([op, col, v]); return b; };
      Object.assign(b, {
        select: (cols: string) => { call.cols = cols; return b; },
        eq: add("eq"), in: add("in"), gte: add("gte"), lt: add("lt"), order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: o.calendar ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => {
          const ids = call.filters.find((f) => f[0] === "in" && f[1] === "id")?.[2] as string[] | undefined;
          const acct = call.filters.find((f) => f[0] === "eq" && f[1] === "account_id")?.[2];
          const data = ids
            ? ids.map((id) => o.byId?.[id]).filter((r) => r && r.account_id === acct)
            : (o.window ?? []);
          return Promise.resolve({ data, error: null }).then(res);
        },
      });
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("rescheduleRoots — one appointment's identity, in batches", () => {
  it("walks a 2-deep chain to its root in 2 queries, not one per row (mutation: query per row → FAILS)", async () => {
    const { db, calls } = fake({ byId: {
      b2: { id: "b2", rescheduled_from_id: "b1", account_id: "A" },
      b1: { id: "b1", rescheduled_from_id: null, account_id: "A" },
    } });
    const roots = await rescheduleRoots(db, "A", [{ id: "b3", rescheduled_from_id: "b2" }, { id: "x", rescheduled_from_id: null }]);
    expect(roots.get("b3")).toEqual({ rootId: "b1", depth: 2 });
    expect(roots.get("x")).toEqual({ rootId: "x", depth: 0 });
    expect(calls.filter((c) => c.table === "bookings")).toHaveLength(2);
  });
  it("never follows a parent outside the account: that row is left out (mutation: drop .eq(account_id) on the hop → FAILS)", async () => {
    const { db, calls } = fake({ byId: { other: { id: "other", rescheduled_from_id: null, account_id: "B" } } });
    const roots = await rescheduleRoots(db, "A", [{ id: "b9", rescheduled_from_id: "other" }]);
    expect(roots.has("b9")).toBe(false);
    expect(calls.every((c) => c.filters.some((f) => f[0] === "eq" && f[1] === "account_id" && f[2] === "A"))).toBe(true);
  });
});

describe("listFeedBookings — the bounded window", () => {
  const CAL = { id: "cal-A", meeting_type: "phone" };
  const raw = (id: string) => ({ id, status: "booked", starts_at: "2026-11-03T15:00:00Z", ends_at: "2026-11-03T16:00:00Z",
    updated_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z", rescheduled_from_id: null,
    contacts: { first_name: "Maria", assigned_to: null } });
  it("reads the account's own calendar, the three statuses only, with no cancelled rows (mutation: add 'cancelled' → FAILS)", async () => {
    const { db, calls } = fake({ calendar: CAL, window: [raw("b1")] });
    const r = await listFeedBookings(db, "A", { now: new Date("2026-11-01T00:00:00Z"), technicianUserId: null });
    expect(r.meetingType).toBe("phone");
    expect(r.rows.map((x) => x.id)).toEqual(["b1", "b1"]);   // the fake answers both window queries with the same row
    const windows = calls.filter((c) => c.table === "bookings" && c.cols.includes("contacts!inner"));
    expect(windows).toHaveLength(2);
    for (const w of windows) {
      expect(w.filters).toContainEqual(["eq", "account_id", "A"]);
      expect(w.filters).toContainEqual(["eq", "calendar_id", "cal-A"]);
      expect(w.filters).toContainEqual(["in", "status", ["booked", "completed", "no_show"]]);
      expect(w.filters.some((f) => f[1] === "contacts.assigned_to")).toBe(false);
    }
    const cal = calls.find((c) => c.table === "calendars");
    expect(cal?.filters).toContainEqual(["eq", "account_id", "A"]);
  });
  it("reads [now - 30 days, now + 180 days), split at now (mutation: widen either edge → FAILS)", async () => {
    const { db, calls } = fake({ calendar: CAL, window: [] });
    await listFeedBookings(db, "A", { now: new Date("2026-11-01T00:00:00Z"), technicianUserId: null });
    const windows = calls.filter((c) => c.table === "bookings" && c.cols.includes("contacts!inner"));
    const edges = windows.map((w) => w.filters.filter((f) => f[0] === "gte" || f[0] === "lt"));
    expect(edges).toEqual([
      [["gte", "starts_at", "2026-11-01T00:00:00.000Z"], ["lt", "starts_at", "2027-04-30T00:00:00.000Z"]],
      [["gte", "starts_at", "2026-10-02T00:00:00.000Z"], ["lt", "starts_at", "2026-11-01T00:00:00.000Z"]],
    ]);
  });
  it("a Technician's window is fenced to their assigned customers (mutation: ignore technicianUserId → FAILS)", async () => {
    const { db, calls } = fake({ calendar: CAL, window: [] });
    await listFeedBookings(db, "A", { now: new Date(), technicianUserId: "tech-1" });
    const windows = calls.filter((c) => c.table === "bookings" && c.cols.includes("contacts!inner"));
    expect(windows).toHaveLength(2);
    for (const w of windows) expect(w.filters).toContainEqual(["eq", "contacts.assigned_to", "tech-1"]);
  });
  it("no calendar yet is an empty feed, not an error", async () => {
    const { db } = fake({ calendar: null });
    expect(await listFeedBookings(db, "A", { now: new Date(), technicianUserId: null })).toEqual({ meetingType: "in_person", rows: [], truncated: false });
  });
  it("says truncated past the cap (mutation: drop the +1 probe row → FAILS)", async () => {
    const many = Array.from({ length: FEED_FUTURE_CAP + 1 }, (_, i) => raw(`b${i}`));
    const { db } = fake({ calendar: CAL, window: many });
    expect((await listFeedBookings(db, "A", { now: new Date(), technicianUserId: null })).truncated).toBe(true);
  });
});

/** A client whose only call is `rpc`, answering `answer` and recording each call. */
function rpcFake(answer: unknown) {
  const rpcs: [string, Record<string, unknown>][] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push([fn, args]); return { data: answer, error: null }; },
  } as unknown as SupabaseClient;
  return { db, rpcs };
}
const OK_CLAIM = { status: "ok", feed_id: "f1", account_id: "acc-A", user_id: "u1", role: "technician", user_language: "es" };

describe("claimCalendarFeedFetch — the claim's answer, read closed", () => {
  it("passes the hash and the hourly limit (120 per 3600 s) to the claim", async () => {
    const { db, rpcs } = rpcFake(OK_CLAIM);
    expect(await claimCalendarFeedFetch(db, "a".repeat(64))).toEqual({
      status: "ok", feedId: "f1", accountId: "acc-A", userId: "u1", role: "technician", userLanguage: "es",
    });
    expect(rpcs).toEqual([["claim_calendar_feed_fetch", { p_token_hash: "a".repeat(64), p_max: 120, p_window_seconds: 3600 }]]);
    expect([CALENDAR_FEED_FETCH_MAX, CALENDAR_FEED_FETCH_WINDOW_SECONDS, CALENDAR_FEED_UNDO_SECONDS]).toEqual([120, 3600, 30]);
  });
  it("an unknown role fails closed, never becoming 'sees all' (mutation: drop ROLES.includes → FAILS)", async () => {
    const { db } = rpcFake({ ...OK_CLAIM, role: "admin" });
    await expect(claimCalendarFeedFetch(db, "a".repeat(64))).rejects.toThrow("claimCalendarFeedFetch: unexpected answer");
  });
  it("a language other than en or es is no language", async () => {
    const { db } = rpcFake({ ...OK_CLAIM, user_language: "fr" });
    expect(await claimCalendarFeedFetch(db, "a".repeat(64))).toMatchObject({ status: "ok", userLanguage: null });
  });
  it("not_found and rate_limited pass through; a rate limit without a number throws", async () => {
    expect(await claimCalendarFeedFetch(rpcFake({ status: "not_found" }).db, "a".repeat(64))).toEqual({ status: "not_found" });
    expect(await claimCalendarFeedFetch(rpcFake({ status: "rate_limited", retry_after_seconds: 42 }).db, "a".repeat(64)))
      .toEqual({ status: "rate_limited", retryAfterSeconds: 42 });
    await expect(claimCalendarFeedFetch(rpcFake({ status: "rate_limited" }).db, "a".repeat(64))).rejects.toThrow();
    await expect(claimCalendarFeedFetch(rpcFake(null).db, "a".repeat(64))).rejects.toThrow();
  });
  it("restore sends the 30-second Undo window and rejects an answer it does not know", async () => {
    const { db, rpcs } = rpcFake("restored");
    expect(await restoreCalendarFeed(db, { accountId: "acc-A", userId: "u1", feedId: "f1", revokedAt: "2026-11-01T00:00:00+00:00", replacementId: "n1" })).toBe("restored");
    expect(rpcs[0]?.[1]).toEqual({ p_account_id: "acc-A", p_user_id: "u1", p_feed_id: "f1", p_revoked_at: "2026-11-01T00:00:00+00:00", p_replacement_id: "n1", p_max_age_seconds: 30 });
    await expect(restoreCalendarFeed(rpcFake("ok").db, { accountId: "acc-A", userId: "u1", feedId: "f1", revokedAt: "x", replacementId: null })).rejects.toThrow();
  });
});

/** Records every filter and every rpc argument; answers nothing. */
function feedsFake() {
  const filters: [string, string, unknown][] = [];
  const rpcs: [string, Record<string, unknown>][] = [];
  const b: Record<string, unknown> = {};
  const add = (op: string) => (col: string, v: unknown) => { filters.push([op, col, v]); return b; };
  Object.assign(b, { select: () => b, eq: add("eq"), is: add("is"), maybeSingle: async () => ({ data: null, error: null }) });
  const db = {
    from: () => b,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push([fn, args]);
      return { data: fn === "restore_calendar_feed" ? "changed" : { status: "none" }, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, filters, rpcs };
}

describe("calendar link wrappers are scoped to the account they are given (second account, review I4)", () => {
  it("readLiveCalendarFeed filters by THIS account and person, live rows only (mutation: drop .eq(account_id) → FAILS)", async () => {
    const { db, filters } = feedsFake();
    await readLiveCalendarFeed(db, "acc-B", "u1");
    expect(filters).toEqual(expect.arrayContaining([["eq", "account_id", "acc-B"], ["eq", "user_id", "u1"], ["is", "revoked_at", null]]));
  });
  it("revoke, replace and restore pass THIS account to the database (mutation: send a fixed account → FAILS)", async () => {
    const { db, rpcs } = feedsFake();
    expect(await revokeCalendarFeed(db, "acc-B", "u1")).toBeNull();
    expect(await replaceCalendarFeed(db, { accountId: "acc-B", userId: "u1", newId: "n1", newHash: "h".repeat(64), createdBy: "c" })).toEqual({ status: "none" });
    expect(await restoreCalendarFeed(db, { accountId: "acc-B", userId: "u1", feedId: "f1", revokedAt: "2026-11-01T00:00:00+00:00", replacementId: null })).toBe("changed");
    expect(rpcs.map(([fn, a]) => [fn, a.p_account_id, a.p_user_id])).toEqual([
      ["revoke_calendar_feed", "acc-B", "u1"], ["replace_calendar_feed", "acc-B", "u1"], ["restore_calendar_feed", "acc-B", "u1"],
    ]);
  });
});
