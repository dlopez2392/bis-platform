import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listDueFollowups, getDueFollowupById } from "./booking";
import {
  listDueReviewRequests, getDueReviewRequestById, listDueReferralAsks, getDueReferralAskById,
} from "./automations";
import { listCheckinsMissingTask } from "./job-checkins";

/**
 * F-072 PR 3's data-layer guards, against a fake that answers each TABLE with a fixed value and records what was
 * asked. The live twins (a real database) are in test/automations.test.ts and test/job-checkins.test.ts; these run
 * without one, so the guards are proven where this checkout can run them.
 *
 *  - the calendar follow-up stands down for a booking whose check-in went out (plan D7a, owner answer Q2);
 *  - the referral ask skips a booking whose customer answered "not great" (D7b, Q5);
 *  - the review-request due row carries the account's mailing address (D4: the check-in's footer prints it);
 *  - the sweep's read: "not great" answers with no To-do, bounded.
 */
type Call = { table: string; method: string; args: unknown[] };
function fakeDb(answers: Record<string, unknown>, errors: Record<string, string> = {}) {
  const calls: Call[] = [];
  const chainFor = (table: string): unknown => {
    let single = false;
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            const seeded = Object.prototype.hasOwnProperty.call(answers, table);
            const answer = seeded ? answers[table] : (single ? null : []);
            // A by-id read asks for ONE row: the first of a seeded list, enabled (the recipe read's `enabled`).
            const data = single && Array.isArray(answer) ? { enabled: true, ...(answer[0] as object) } : answer;
            const error = Object.prototype.hasOwnProperty.call(errors, table) ? { message: errors[table] } : null;
            return Promise.resolve({ data: error ? null : data, error, count: 0 }).then(res, rej);
          };
        }
        if (method === "maybeSingle" || method === "single") single = true;
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  return { db: { from: (t: string) => chainFor(t) } as unknown as SupabaseClient, calls };
}
const readTables = (calls: Call[]) => calls.filter((c) => c.method === "select").map((c) => c.table);

const ACCT = "acct-1";
const NOW = "2026-09-10T15:00:00.000Z";
const ACCOUNT_ROW = {
  timezone: "America/Chicago", brand_name: "Rio Roofing", brand_logo_path: null, brand_color: null, brand_neutral: null,
  brand_corners: null, brand_type: null, brand_mode: null, reply_to_email: "owner@rio.test", from_email: null,
  outbound_suppressed: false, mailing_address: "12 Main St, McAllen TX", language: "en",
};
const CHECKIN_ON = [{ account_id: ACCT, body: "", body_es: null, config: { channel: "email", reviewUrl: "https://g.page/r/x/review", checkin: true } }];
const CHECKIN_OFF = [{ account_id: ACCT, body: "", body_es: null, config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }];

const followupRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, account_id: ACCT, contact_id: `c-${id}`, starts_at: "2026-09-09T13:00:00Z", ends_at: "2026-09-09T14:00:00Z",
  closure_kept_at: null, review_requested_at: null,
  calendars: { account_id: ACCT, followup_body: "", followup_body_es: null, followup_enabled: true },
  contacts: { account_id: ACCT, first_name: "Ana", last_name: "P", email: "ana@example.com", language: null, archived_at: null },
  ...over,
});

describe("the calendar follow-up stands down for a check-in that went out (D7a, Q2)", () => {
  it("drops a booking with review_requested_at set when its account has checkin on, and keeps the rest (mutation: drop the filter -> FAILS)", async () => {
    const { db } = fakeDb({
      bookings: [followupRow("asked", { review_requested_at: "2026-09-09T16:00:00Z" }), followupRow("plain")],
      accounts: ACCOUNT_ROW, automations: CHECKIN_ON,
    });
    const due = await listDueFollowups(db, NOW);
    expect(due.map((d) => d.bookingId)).toEqual(["plain"]);
  });

  it("keeps it when the account's check-in is off (an old-flow stamp never silences the follow-up)", async () => {
    const { db } = fakeDb({
      bookings: [followupRow("asked", { review_requested_at: "2026-09-09T16:00:00Z" })],
      accounts: ACCOUNT_ROW, automations: CHECKIN_OFF,
    });
    expect((await listDueFollowups(db, NOW)).map((d) => d.bookingId)).toEqual(["asked"]);
  });

  it("only the boolean true counts: a stored 'true' string or 1 does not silence anything", async () => {
    for (const checkin of ["true", 1, "yes"]) {
      const { db } = fakeDb({
        bookings: [followupRow("asked", { review_requested_at: "2026-09-09T16:00:00Z" })],
        accounts: ACCOUNT_ROW, automations: [{ ...CHECKIN_ON[0], config: { ...CHECKIN_ON[0]!.config, checkin } }],
      });
      expect((await listDueFollowups(db, NOW)).map((d) => d.bookingId), String(checkin)).toEqual(["asked"]);
    }
  });

  it("reads the recipes only when a due booking was actually asked: an account without the feature costs no extra query", async () => {
    const { db, calls } = fakeDb({ bookings: [followupRow("plain")], accounts: ACCOUNT_ROW, automations: CHECKIN_ON });
    expect((await listDueFollowups(db, NOW)).map((d) => d.bookingId)).toEqual(["plain"]);
    expect(readTables(calls)).not.toContain("automations");
  });

  it("a recipe read that fails degrades safely: the asked booking stands down this tick, the rest still go, the pass is not taken down", async () => {
    const { db } = fakeDb({
      bookings: [followupRow("asked", { review_requested_at: "2026-09-09T16:00:00Z" }), followupRow("plain")],
      accounts: ACCOUNT_ROW, automations: CHECKIN_ON,
    }, { automations: "boom" });
    expect((await listDueFollowups(db, NOW)).map((d) => d.bookingId)).toEqual(["plain"]);
  });

  it("the by-id read a release makes stands down the same way: gone, so the held row leaves the queue", async () => {
    const { db } = fakeDb({
      bookings: followupRow("asked", { review_requested_at: "2026-09-09T16:00:00Z" }), accounts: ACCOUNT_ROW, automations: CHECKIN_ON,
    });
    expect(await getDueFollowupById(db, "asked")).toEqual({ due: null, why: "gone" });
  });

  it("the by-id read still returns a booking that was not asked", async () => {
    const { db } = fakeDb({ bookings: followupRow("plain"), accounts: ACCOUNT_ROW, automations: CHECKIN_ON });
    expect((await getDueFollowupById(db, "plain")).due?.bookingId).toBe("plain");
  });
});

const referralRow = (id: string) => ({
  id, account_id: ACCT, contact_id: `c-${id}`, starts_at: "2026-09-08T13:00:00Z", ends_at: "2026-09-08T14:00:00Z",
  completed_at: "2026-09-08T15:00:00Z", followup_sent_at: null, review_requested_at: "2026-09-08T17:00:00Z",
  referral_ask_sms_failed_at: null, closure_kept_at: null,
  contacts: { account_id: ACCT, email: "ana@example.com", phone: null, language: null, archived_at: null },
});
const REFERRAL_ON = [{ account_id: ACCT, body: "", body_es: null, config: { channel: "email" } }];

describe("the referral ask skips a customer who said 'not great' (D7b, Q5)", () => {
  it("drops a booking with a not-great check-in and keeps the others (mutation: drop the exclusion -> FAILS)", async () => {
    const { db } = fakeDb({
      bookings: [referralRow("bad"), referralRow("fine")], accounts: ACCOUNT_ROW, automations: REFERRAL_ON,
      job_checkins: [{ booking_id: "bad" }],
    });
    expect((await listDueReferralAsks(db, NOW)).map((d) => d.bookingId)).toEqual(["fine"]);
  });

  it("asks the check-ins for not_great ONLY, scoped to the accounts in play and bounded (never platform-wide)", async () => {
    const { db, calls } = fakeDb({ bookings: [referralRow("fine")], accounts: ACCOUNT_ROW, automations: REFERRAL_ON, job_checkins: [] });
    await listDueReferralAsks(db, NOW);
    const asked = calls.filter((c) => c.table === "job_checkins").map((c) => [c.method, ...c.args]);
    expect(asked).toContainEqual(["eq", "answer", "not_great"]);
    expect(asked).toContainEqual(["in", "account_id", [ACCT]]);
    expect(asked.some((a) => a[0] === "limit")).toBe(true);
  });

  it("a not-great read that fails FAILS CLOSED for the tick: no referral ask is due, nothing throws", async () => {
    const { db } = fakeDb({ bookings: [referralRow("a"), referralRow("b")], accounts: ACCOUNT_ROW, automations: REFERRAL_ON }, { job_checkins: "boom" });
    expect(await listDueReferralAsks(db, NOW)).toEqual([]);
  });

  it("the by-id read a release makes excludes it too: gone", async () => {
    const { db } = fakeDb({
      bookings: referralRow("bad"), accounts: ACCOUNT_ROW, automations: REFERRAL_ON, job_checkins: { booking_id: "bad" },
    });
    expect(await getDueReferralAskById(db, "bad")).toEqual({ due: null, why: "gone" });
  });

  it("the by-id read keeps a booking with no not-great answer", async () => {
    const { db } = fakeDb({ bookings: referralRow("fine"), accounts: ACCOUNT_ROW, automations: REFERRAL_ON, job_checkins: null });
    expect((await getDueReferralAskById(db, "fine")).due?.bookingId).toBe("fine");
  });
});

describe("the review-request due row carries the account's mailing address (D4)", () => {
  const reviewRow = {
    id: "bk-1", account_id: ACCT, contact_id: "c-1", starts_at: "2026-09-09T13:00:00Z", ends_at: "2026-09-09T14:00:00Z",
    completed_at: "2026-09-09T14:30:00Z", followup_sent_at: null, review_request_sms_failed_at: null, closure_kept_at: null,
    contacts: { account_id: ACCT, email: "ana@example.com", phone: null, language: null, archived_at: null },
  };
  it("lists it, and the by-id twin a release reads carries it too (mutation: drop the field -> FAILS)", async () => {
    const { db } = fakeDb({ bookings: [reviewRow], accounts: ACCOUNT_ROW, automations: CHECKIN_ON });
    expect((await listDueReviewRequests(db, NOW))[0]?.mailingAddress).toBe("12 Main St, McAllen TX");
    const one = fakeDb({ bookings: reviewRow, accounts: ACCOUNT_ROW, automations: CHECKIN_ON });
    expect((await getDueReviewRequestById(one.db, "bk-1")).due?.mailingAddress).toBe("12 Main St, McAllen TX");
  });
});

describe("listCheckinsMissingTask: the sweep's read", () => {
  const checkin = (id: string) => ({
    id, account_id: ACCT, booking_id: `bk-${id}`, contact_id: `c-${id}`, answer: "not_great",
    answered_at: "2026-09-10T14:00:00Z", review_link_opened_at: null, tasks: [],
  });

  it("returns what the query returns, as check-ins: the 'no To-do' filter is in the QUERY, not applied afterwards", async () => {
    const { db } = fakeDb({ job_checkins: [checkin("a"), checkin("b")] });
    expect((await listCheckinsMissingTask(db, "2026-09-01T00:00:00Z", 50)).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("filters to answers with NO linked To-do (the anti-join), not_great only, inside the window, newest first, bounded (mutation: drop the null filter -> FAILS)", async () => {
    const { db, calls } = fakeDb({ job_checkins: [] });
    await listCheckinsMissingTask(db, "2026-09-01T00:00:00Z", 50);
    const asked = calls.filter((c) => c.table === "job_checkins").map((c) => [c.method, ...c.args]);
    expect(asked).toEqual(expect.arrayContaining([
      ["eq", "answer", "not_great"], ["gte", "answered_at", "2026-09-01T00:00:00Z"], ["is", "tasks", null],
      ["order", "answered_at", { ascending: false }], ["limit", 50],
    ]));
    expect(String(asked.find((a) => a[0] === "select")![1])).toContain("tasks!review_checkin_id(id)");
  });

  it("never reads To-dos separately: no second read exists to be crowded by the page", async () => {
    const { db, calls } = fakeDb({ job_checkins: [checkin("a")], tasks: [{ review_checkin_id: "a" }] });
    await listCheckinsMissingTask(db, "2026-09-01T00:00:00Z", 50);
    expect(readTables(calls)).not.toContain("tasks");
  });

  it("a read error throws (the sweep counts it)", async () => {
    const { db } = fakeDb({}, { job_checkins: "boom" });
    await expect(listCheckinsMissingTask(db, "2026-09-01T00:00:00Z", 50)).rejects.toThrow(/boom/);
  });
});
