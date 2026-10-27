import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-048 follow-up: the business-cancel notice survives the process that
 * queued it. These cases run the REAL delivery (`cancel-notice.ts`) for both
 * senders, the `after()` job and this sweep, against a small in-memory model
 * of the rows they share: the booking (status + version, which
 * `claimCancelNotice` compares and moves on), the notice's thread row, and
 * its pending row in `booking_cancel_notices` (0100, whose message FK
 * cascades). The model's claim is the database's conditional UPDATE: exactly
 * one caller per version wins. So every race below is decided by the same
 * rule production uses, not by a mock's script.
 */
type Booking = { accountId: string; status: string; version: string; startsAt: string };
type Message = { status: string; error?: string };
type Pending = {
  bookingId: string; accountId: string; version: string; messageId: string; userId: string;
  email: unknown; dueAt: string; createdAt: string;
};

const m = vi.hoisted(() => ({
  bookings: new Map<string, Booking>(),
  messages: new Map<string, Message>(),
  pending: new Map<string, Pending>(),
  claims: 0,
  failNext: { markSent: false, dropPending: false },
  listCalls: [] as unknown[][],
  /** Bookings whose claim THROWS (a database that keeps failing for one row). */
  claimThrows: new Set<string>(),
  /** Bookings whose embed comes back without a start (PostgREST found no booking row to embed). */
  noStart: new Set<string>(),
}));

vi.mock("@bis/db", () => ({
  claimCancelNotice: async (_db: unknown, accountId: string, bookingId: string, version: string) => {
    if (m.claimThrows.has(bookingId)) throw new Error("db down");
    const b = m.bookings.get(bookingId);
    if (!b || b.accountId !== accountId || b.status !== "cancelled" || b.version !== version) return false;
    b.version = `claimed-${++m.claims}`;
    return true;
  },
  readBookingStatus: async (_db: unknown, accountId: string, bookingId: string) => {
    const b = m.bookings.get(bookingId);
    return b && b.accountId === accountId ? b.status : null;
  },
  discardQueuedNotice: async (_db: unknown, _accountId: string, messageId: string) => {
    if (m.messages.get(messageId)?.status !== "queued") return false;
    m.messages.delete(messageId);
    // 0100: message_id ... on delete cascade.
    for (const [k, p] of m.pending) if (p.messageId === messageId) m.pending.delete(k);
    return true;
  },
  updateMessageStatus: async (_db: unknown, _accountId: string, messageId: string, status: string, patch: { error?: string } = {}) => {
    if (status === "sent" && m.failNext.markSent) { m.failNext.markSent = false; throw new Error("db down"); }
    const row = m.messages.get(messageId);
    if (row) Object.assign(row, { status, ...(patch.error !== undefined ? { error: patch.error } : {}) });
  },
  deletePendingCancelNotice: async (_db: unknown, accountId: string, bookingId: string, version: string) => {
    if (m.failNext.dropPending) { m.failNext.dropPending = false; throw new Error("db down"); }
    const p = m.pending.get(bookingId);
    if (!p || p.accountId !== accountId || p.version !== version) return false;
    m.pending.delete(bookingId);
    return true;
  },
  listDueCancelNotices: async (db: unknown, dueBy: string, limit: number) => {
    m.listCalls.push([db, dueBy, limit]);
    return [...m.pending.values()]
      .filter((p) => Date.parse(p.dueAt) <= Date.parse(dueBy))
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .slice(0, limit)
      .map((p) => ({ ...p, startsAt: m.noStart.has(p.bookingId) ? null : m.bookings.get(p.bookingId)?.startsAt ?? null }));
  },
  // cancel-notice.ts imports these for the queue step, which these cases never run.
  getContact: vi.fn(), ensureConversation: vi.fn(), createMessage: vi.fn(), loadAccountBrandInfo: vi.fn(),
  bookingContactEmail: vi.fn(), readEmailSuppression: vi.fn(),
  // The REAL email gate runs in the suppressed-account case below; its step 2b reads this first.
  isAccountOutboundSuppressed: vi.fn(async () => false),
  serviceDb: () => { throw new Error("tests pass their own db"); },
}));
const afterSends = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/email-gate", () => ({ sendEmailOrThrow: afterSends }));

import {
  cancelNoticesPass, CANCEL_NOTICE_SWEEP_SLACK_MS, CANCEL_NOTICE_MAX_AGE_MS, CANCEL_NOTICE_SWEEP_BATCH,
  CANCEL_NOTICE_BUDGET_MS, CANCEL_NOTICE_ABANDON_MS,
} from "./cancel-notices";
import * as dbModule from "@bis/db";
import {
  sendQueuedCancelNotice, CANCEL_NOTICE_EXPIRED, type ComposedCancelNotice,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/cancel-notice";
import type { PassContext } from "../context";

const DB = { tick: true };
const CANCELLED_AT = Date.parse("2026-10-27T15:00:00.000Z");
const V = "2026-10-27T15:00:00.000Z";
const EMAIL: ComposedCancelNotice = {
  contactId: "contact_1", to: "ana@example.com", locale: "en", origin: "https://app.example.com",
  fromName: "Rio Roofing", subject: "Your booking has been cancelled", text: "t", html: "<p>t</p>",
};
const tickSends = vi.fn();

/** The cancel's own request: the booking cancelled at version V, its thread row queued, its pending row due
 *  when the Undo window and grace close. */
function cancel(id = "bk_1", over: Partial<Booking> = {}, pendingOver: Partial<Pending> = {}) {
  m.bookings.set(id, { accountId: "acct_1", status: "cancelled", version: V, startsAt: "2026-10-30T15:00:00.000Z", ...over });
  m.messages.set(`msg_${id}`, { status: "queued" });
  m.pending.set(id, {
    bookingId: id, accountId: "acct_1", version: V, messageId: `msg_${id}`, userId: "user_1", email: EMAIL,
    dueAt: new Date(CANCELLED_AT + 15_000).toISOString(), createdAt: new Date(CANCELLED_AT).toISOString(), ...pendingOver,
  });
}
/** The Undo landing first (`undoOperatorCancel`): back to booked under a new version. `ownCleanup` is the
 *  Undo action's best-effort removal of the queued and pending rows; false = both failed. */
function undo(id = "bk_1", ownCleanup = false) {
  const b = m.bookings.get(id)!;
  Object.assign(b, { status: "booked", version: "undo-version" });
  if (ownCleanup) { m.messages.delete(`msg_${id}`); m.pending.delete(id); }
}
const ctxAt = (ms: number): PassContext => ({
  db: DB as never, now: new Date(ms), origin: "https://app.example.com",
  email: { isFake: true, send: tickSends }, sms: {} as never, closures: {} as never,
});
const sweep = (ms = CANCELLED_AT + 15 * 60_000) => cancelNoticesPass.run(ctxAt(ms));
const afterJob = (id = "bk_1") => sendQueuedCancelNotice(
  { accountId: "acct_1", bookingId: id, version: V, userId: "user_1", queued: { messageId: `msg_${id}`, email: EMAIL } },
  { db: DB as never, sleep: async () => {} },
);
const emailsSent = () => tickSends.mock.calls.length + afterSends.mock.calls.length;

beforeEach(() => {
  m.bookings.clear(); m.messages.clear(); m.pending.clear(); m.claims = 0; m.listCalls.length = 0;
  m.claimThrows.clear(); m.noStart.clear();
  vi.mocked(dbModule.isAccountOutboundSuppressed).mockReset().mockResolvedValue(false);
  vi.restoreAllMocks();
  m.failNext = { markSent: false, dropPending: false };
  tickSends.mockReset().mockResolvedValue({ providerMessageId: "re_tick" });
  afterSends.mockReset().mockResolvedValue({ providerMessageId: "re_after" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the sweep: a notice whose process died is still sent, once", () => {
  it("process died (no after()): the next tick sends it through the tick's gate, marks the row sent and settles the pending row; the tick after sends nothing (mutation: no sweep pass → the customer is never told, FAILS)", async () => {
    cancel();
    expect(await sweep()).toMatchObject({ sent: 1 });
    expect(tickSends).toHaveBeenCalledTimes(1);
    expect(tickSends.mock.calls[0]![0]).toMatchObject({ kind: "staff.booking_cancel_notice", accountId: "acct_1", to: "ana@example.com" });
    expect(afterSends).not.toHaveBeenCalled();
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "sent" });
    expect(m.pending.size).toBe(0);
    expect(await sweep(CANCELLED_AT + 30 * 60_000)).toMatchObject({ sent: 0 });
    expect(emailsSent()).toBe(1);
  });

  it("reads rows due at least two minutes ago, oldest first, bounded (mutation: read up to `now` → it races a live after(), FAILS)", async () => {
    const now = CANCELLED_AT + 15 * 60_000;
    await sweep(now);
    expect(m.listCalls).toEqual([[DB, new Date(now - CANCEL_NOTICE_SWEEP_SLACK_MS).toISOString(), CANCEL_NOTICE_SWEEP_BATCH]]);
    expect(CANCEL_NOTICE_SWEEP_SLACK_MS).toBe(2 * 60_000);
  });

  it("leaves a notice whose after() may still be running: due under two minutes ago, untouched", async () => {
    cancel();
    expect(await sweep(CANCELLED_AT + 15_000 + 60_000)).toMatchObject({ sent: 0 });
    expect(tickSends).not.toHaveBeenCalled();
    expect(m.pending.size).toBe(1);
    expect(m.bookings.get("bk_1")!.version).toBe(V);
  });
});

describe("rule 4 — a lost claim discards the queued row ONLY when the Undo won", () => {
  it("after() WINS, then the sweep: after() sent but could not mark the row sent nor settle its pending row, so the sweep finds a QUEUED row behind a SENT email. The sweep loses the claim, the booking is still cancelled: it removes only its pending row and the message is untouched (mutation: discard on every lost claim → the sent email's record is deleted, FAILS)", async () => {
    cancel();
    m.failNext = { markSent: true, dropPending: true };
    expect(await afterJob()).toBe("sent");
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "queued" });
    expect(m.pending.size).toBe(1);

    expect(await sweep()).toMatchObject({ sent: 0, elsewhere: 1 });
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "queued" });
    expect(m.pending.size).toBe(0);
    expect(emailsSent()).toBe(1);
  });

  it("the sweep WINS, then after(): after() loses the claim on a booking still cancelled and does NOT discard the queued row the sweep's sent email left (mutation: discard on every lost claim → FAILS)", async () => {
    cancel();
    m.failNext.markSent = true;
    expect(await sweep()).toMatchObject({ sent: 1 });
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "queued" });

    expect(await afterJob()).toBe("elsewhere");
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "queued" });
    expect(emailsSent()).toBe(1);
  });

  it("the Undo WINS and its own clean-up failed: after() loses the claim, sees the booking booked, discards the queued row, and the pending row goes with it; the sweep then finds nothing (mutation: never discard on a lost claim → the undone cancel keeps a queued email, FAILS)", async () => {
    cancel();
    undo("bk_1", false);
    expect(await afterJob()).toBe("undone");
    expect(m.messages.has("msg_bk_1")).toBe(false);
    expect(m.pending.size).toBe(0);
    expect(await sweep()).toMatchObject({ sent: 0, undone: 0, elsewhere: 0 });
    expect(emailsSent()).toBe(0);
  });

  it("the Undo WINS and after() died too: the sweep loses the claim, sees the booking booked and discards the queued row; nothing is sent", async () => {
    cancel();
    undo("bk_1", false);
    expect(await sweep()).toMatchObject({ undone: 1, sent: 0 });
    expect(m.messages.has("msg_bk_1")).toBe(false);
    expect(m.pending.size).toBe(0);
    expect(emailsSent()).toBe(0);
  });

  it("the Undo WINS and cleans up after itself: neither sender finds anything to send", async () => {
    cancel();
    undo("bk_1", true);
    expect(await afterJob()).toBe("undone");
    expect(await sweep()).toMatchObject({ sent: 0 });
    expect(emailsSent()).toBe(0);
  });
});

describe("too late to tell the customer: never sent, said so on the thread", () => {
  it("the appointment has started: claimed, not sent, the row marked failed with the reason, the pending row settled (mutation: no start check → an email about a past appointment goes, FAILS)", async () => {
    cancel("bk_1", { startsAt: new Date(CANCELLED_AT + 10 * 60_000).toISOString() });
    expect(await sweep(CANCELLED_AT + 15 * 60_000)).toMatchObject({ expired: 1, sent: 0 });
    expect(emailsSent()).toBe(0);
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "failed", error: CANCEL_NOTICE_EXPIRED.started });
    expect(m.pending.size).toBe(0);
  });

  it("the cancel is a day old: not sent, marked failed with its own reason (mutation: no age check → FAILS)", async () => {
    cancel("bk_1", { startsAt: new Date(CANCELLED_AT + 5 * 86_400_000).toISOString() });
    expect(await sweep(CANCELLED_AT + CANCEL_NOTICE_MAX_AGE_MS + 60_000)).toMatchObject({ expired: 1, sent: 0 });
    expect(emailsSent()).toBe(0);
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "failed", error: CANCEL_NOTICE_EXPIRED.too_old });
    expect(CANCEL_NOTICE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("just inside a day and before the appointment: still sent", async () => {
    cancel("bk_1", { startsAt: new Date(CANCELLED_AT + 5 * 86_400_000).toISOString() });
    expect(await sweep(CANCELLED_AT + CANCEL_NOTICE_MAX_AGE_MS - 60_000)).toMatchObject({ sent: 1, expired: 0 });
  });

  it("a stale notice whose Undo won is discarded, never marked failed", async () => {
    cancel("bk_1", { startsAt: new Date(CANCELLED_AT + 10 * 60_000).toISOString() });
    undo("bk_1", false);
    expect(await sweep(CANCELLED_AT + 15 * 60_000)).toMatchObject({ undone: 1, expired: 0 });
    expect(m.messages.has("msg_bk_1")).toBe(false);
  });
});

describe("the edges of too late (m5)", () => {
  it("an appointment that starts at exactly this tick is too late: expired, not sent (mutation: `startsAt < now` → it is sent, FAILS)", async () => {
    const now = CANCELLED_AT + 15 * 60_000;
    cancel("bk_1", { startsAt: new Date(now).toISOString() });
    expect(await sweep(now)).toMatchObject({ expired: 1, sent: 0 });
    expect(emailsSent()).toBe(0);
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "failed", error: CANCEL_NOTICE_EXPIRED.started });
  });

  it("a row whose appointment start could not be read is too late: expired, not sent (mutation: `startsAt < now` → NaN is never late and it is sent, FAILS)", async () => {
    cancel();
    m.noStart.add("bk_1");
    expect(await sweep()).toMatchObject({ expired: 1, sent: 0 });
    expect(emailsSent()).toBe(0);
    expect(m.pending.size).toBe(0);
  });
});

describe("a suppressed account (I1): the read includes it, the gate refuses it, the row settles", () => {
  it("the REAL email gate refuses suppressed_account: nothing is sent, the thread row is marked failed with the gate's reason, the pending row is gone (mutation: settle nothing on a refused send → the row heads every batch for good, FAILS)", async () => {
    const real = await vi.importActual<typeof import("@/lib/consent/email-gate")>("@/lib/consent/email-gate");
    // The tick's ctx.email.send IS sendEmailOrThrow on the tick's client (harness.ts, emailSenderFor).
    tickSends.mockReset().mockImplementation((req) => real.sendEmailOrThrow(req, { db: DB as never }));
    vi.mocked(dbModule.isAccountOutboundSuppressed).mockResolvedValue(true);
    cancel();
    expect(await sweep()).toMatchObject({ failed: 1, sent: 0 });
    expect(dbModule.isAccountOutboundSuppressed).toHaveBeenCalledWith(DB, "acct_1");
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "failed", error: "email not sent: suppressed_account" });
    expect(m.pending.size).toBe(0);
    expect(await sweep(CANCELLED_AT + 30 * 60_000)).toMatchObject({ failed: 0, sent: 0 });
  });
});

describe("a row that never settles is not kept forever (m3)", () => {
  it("past 48 hours a row is removed whatever its claim does, the thread row left as it is, and the ids are logged (mutation: no abandon rule → it stays at the head of every batch, FAILS)", async () => {
    cancel("bk_1", { startsAt: new Date(CANCELLED_AT + 10 * 86_400_000).toISOString() });
    m.claimThrows.add("bk_1");
    expect(await sweep(CANCELLED_AT + CANCEL_NOTICE_MAX_AGE_MS + 60_000)).toMatchObject({ unsettled: 1 });
    expect(m.pending.size).toBe(1);
    expect(await sweep(CANCELLED_AT + CANCEL_NOTICE_ABANDON_MS + 60_000)).toMatchObject({ abandoned: 1, unsettled: 0 });
    expect(m.pending.size).toBe(0);
    expect(m.messages.get("msg_bk_1")).toEqual({ status: "queued" });
    expect(emailsSent()).toBe(0);
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("bk_1");
    expect(logged).toContain("acct_1");
    expect(logged).not.toContain("ana@example.com");
    expect(CANCEL_NOTICE_ABANDON_MS).toBe(48 * 60 * 60 * 1000);
  });

  it("an abandoned row whose delete fails is counted unsettled and tried again next tick", async () => {
    cancel();
    m.failNext.dropPending = true;
    expect(await sweep(CANCELLED_AT + CANCEL_NOTICE_ABANDON_MS + 60_000)).toMatchObject({ abandoned: 0, unsettled: 1 });
    expect(m.pending.size).toBe(1);
  });
});

describe("the pass's time budget (m1)", () => {
  it("stops STARTING rows once its budget is spent; the rest wait for the next tick, oldest first (mutation: no budget check → all three go this tick, FAILS)", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    tickSends.mockReset().mockImplementation(async () => { clock += 6_000; return { providerMessageId: "re" }; });
    cancel("bk_a", {}, { dueAt: new Date(CANCELLED_AT + 1_000).toISOString() });
    cancel("bk_b", {}, { dueAt: new Date(CANCELLED_AT + 2_000).toISOString() });
    cancel("bk_c", {}, { dueAt: new Date(CANCELLED_AT + 3_000).toISOString() });
    expect(await sweep()).toMatchObject({ sent: 2, deferred: 1 });
    expect([...m.pending.keys()]).toEqual(["bk_c"]);
    expect(CANCEL_NOTICE_BUDGET_MS).toBe(10_000);
  });
});

describe("the pass's own bookkeeping", () => {
  it("reports every outcome under its own counter, and one row's failure never stops the next", async () => {
    cancel("bk_a", {}, { dueAt: new Date(CANCELLED_AT + 1_000).toISOString() });
    cancel("bk_b", {}, { dueAt: new Date(CANCELLED_AT + 2_000).toISOString() });
    tickSends.mockReset().mockRejectedValueOnce(new Error("provider down")).mockResolvedValueOnce({ providerMessageId: "re_2" });
    expect(await sweep()).toEqual({ sent: 1, failed: 1, expired: 0, undone: 0, elsewhere: 0, unsettled: 0, abandoned: 0, deferred: 0 });
    expect(m.messages.get("msg_bk_a")).toMatchObject({ status: "failed" });
    expect(m.messages.get("msg_bk_b")).toEqual({ status: "sent" });
  });

  it("with nothing due it reads once and writes nothing", async () => {
    expect(await sweep()).toEqual({ sent: 0, failed: 0, expired: 0, undone: 0, elsewhere: 0, unsettled: 0, abandoned: 0, deferred: 0 });
    expect(m.listCalls).toHaveLength(1);
  });
});
