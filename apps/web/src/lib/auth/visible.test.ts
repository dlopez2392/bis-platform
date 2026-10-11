import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-085 part 1, spec §7.3: "prove the target through the request client,
 * then write through the service client". `callerCanSee` is the proof: a read
 * through the CALLER's own client (RLS + 0068), scoped to the account and the
 * id. The fake below records every link of the chain, so a read that drops
 * the account scope or reads the wrong table is caught, not just the answer.
 * Each table answers its own result, so a multi-read proof can be driven; a
 * result may be a function of the read's `eq` filters, so a test can prove a
 * filter is APPLIED (a row that matches only without it), not just written.
 */
type Result = { data: unknown; error: unknown };
const fake = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  results: {} as Record<string, { data: unknown; error: unknown } | ((eqs: Record<string, unknown>) => { data: unknown; error: unknown })>,
}));

vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (t: string) => {
      fake.calls.push(["from", t]);
      const eqs: Record<string, unknown> = {};
      const chain = {
        select: (...a: unknown[]) => { fake.calls.push(["select", ...a]); return chain; },
        eq: (col: string, v: unknown) => { fake.calls.push(["eq", col, v]); eqs[col] = v; return chain; },
        maybeSingle: async () => {
          fake.calls.push(["maybeSingle"]);
          const r = fake.results[t] ?? { data: null, error: null };
          return typeof r === "function" ? r(eqs) : r;
        },
      };
      return chain;
    },
  }),
}));

import { callerCanSee, noticeBelongsToBooking } from "./visible";

const row = (data: unknown): Result => ({ data, error: null });

beforeEach(() => {
  fake.calls = [];
  fake.results = {};
});

describe("callerCanSee — the caller's own client vouches for the row (spec §7.3)", () => {
  it("true when the scoped read returns the row, and the read is account- and id-scoped on the named table", async () => {
    fake.results.bookings = row({ id: "bk_1" });
    expect(await callerCanSee("bookings", "acct_1", "bk_1")).toBe(true);
    expect(fake.calls).toEqual([
      ["from", "bookings"],
      ["select", "id"],
      ["eq", "account_id", "acct_1"],
      ["eq", "id", "bk_1"],
      ["maybeSingle"],
    ]);
  });

  it("false when RLS hides the row (the read returns null)", async () => {
    expect(await callerCanSee("conversations", "acct_1", "cv_1")).toBe(false);
    expect(fake.calls[0]).toEqual(["from", "conversations"]);
  });

  it("throws on a read error: 'could not tell' is never 'allowed' (mutation: return true on error → FAILS)", async () => {
    fake.results.bookings = { data: null, error: { message: "boom" } };
    await expect(callerCanSee("bookings", "acct_1", "bk_1")).rejects.toThrow("callerCanSee(bookings) failed: boom");
  });
});

/**
 * Task 5a fix round 1 (F1): the Undo carries a client-supplied notice message
 * id that the service client then deletes or reads. It is acted on only when
 * the caller's own client sees it on the thread of THIS booking's contact.
 */
describe("noticeBelongsToBooking — a notice id is bound to the proven booking's contact", () => {
  beforeEach(() => {
    fake.results.bookings = row({ contact_id: "ct_1" });
    fake.results.messages = row({ conversation_id: "cv_1" });
    fake.results.conversations = row({ id: "cv_1" });
  });

  it("true when the message sits on the booking contact's thread; every read is account-scoped and the thread is matched on that contact", async () => {
    expect(await noticeBelongsToBooking("acct_1", "bk_1", "msg_1")).toBe(true);
    expect(fake.calls).toEqual([
      ["from", "bookings"], ["select", "contact_id"], ["eq", "account_id", "acct_1"], ["eq", "id", "bk_1"], ["maybeSingle"],
      ["from", "messages"], ["select", "conversation_id"], ["eq", "account_id", "acct_1"], ["eq", "id", "msg_1"], ["maybeSingle"],
      ["from", "conversations"], ["select", "id"], ["eq", "account_id", "acct_1"], ["eq", "id", "cv_1"], ["eq", "contact_id", "ct_1"], ["maybeSingle"],
    ]);
  });

  it("false when the message is on another contact's thread (mutation: drop the contact_id match → FAILS)", async () => {
    // msg_other sits on cv_9, ct_9's thread: the thread row exists and is
    // visible, and matches only if the contact filter is NOT applied.
    fake.results.messages = row({ conversation_id: "cv_9" });
    fake.results.conversations = (eqs) =>
      eqs.id === "cv_9" && (eqs.contact_id === undefined || eqs.contact_id === "ct_9") ? row({ id: "cv_9" }) : row(null);
    expect(await noticeBelongsToBooking("acct_1", "bk_1", "msg_other")).toBe(false);
  });

  it("false when the caller cannot see the message (RLS hides it)", async () => {
    fake.results.messages = row(null);
    expect(await noticeBelongsToBooking("acct_1", "bk_1", "msg_1")).toBe(false);
  });

  it("false when the caller cannot see the booking", async () => {
    fake.results.bookings = row(null);
    expect(await noticeBelongsToBooking("acct_1", "bk_1", "msg_1")).toBe(false);
  });

  it.each(["bookings", "messages", "conversations"])("throws when the %s read errors: 'could not tell' is never 'yes'", async (t) => {
    fake.results[t] = { data: null, error: { message: "boom" } };
    await expect(noticeBelongsToBooking("acct_1", "bk_1", "msg_1")).rejects.toThrow(`noticeBelongsToBooking(${t}) failed: boom`);
  });
});
