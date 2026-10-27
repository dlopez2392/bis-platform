import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  claimCancelNotice: vi.fn(),
  getContact: vi.fn(),
  ensureConversation: vi.fn(),
  createMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
  loadAccountBrandInfo: vi.fn(),
  bookingContactEmail: vi.fn(),
  isAccountOutboundSuppressed: vi.fn(),
  readEmailSuppression: vi.fn(),
  discardQueuedNotice: vi.fn(),
  readBookingStatus: vi.fn(),
  deletePendingCancelNotice: vi.fn(),
  rows: { booking: null as unknown, calendar: null as unknown },
}));
vi.mock("@bis/db", () => ({
  claimCancelNotice: db.claimCancelNotice,
  getContact: db.getContact,
  ensureConversation: db.ensureConversation,
  createMessage: db.createMessage,
  updateMessageStatus: db.updateMessageStatus,
  loadAccountBrandInfo: db.loadAccountBrandInfo,
  bookingContactEmail: db.bookingContactEmail,
  isAccountOutboundSuppressed: db.isAccountOutboundSuppressed,
  readEmailSuppression: db.readEmailSuppression,
  discardQueuedNotice: db.discardQueuedNotice,
  readBookingStatus: db.readBookingStatus,
  deletePendingCancelNotice: db.deletePendingCancelNotice,
  serviceDb: () => { throw new Error("tests pass their own db"); },
}));
vi.mock("@/lib/consent/email-gate", () => ({ sendEmailOrThrow: vi.fn() }));

import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import {
  cancelNoticeAvailability, queueCancelNotice, sendQueuedCancelNotice, deliverCancelNotice, expireCancelNotice,
  CANCEL_NOTICE_EXPIRED, type QueueCancelNoticeRequest, type QueuedCancelNotice, type CancelNotice,
} from "./cancel-notice";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";

/** The two rows this module reads itself; everything else is a named
 *  @bis/db helper above. */
const fakeDb = {
  from: (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: table === "bookings" ? db.rows.booking : db.rows.calendar, error: null }),
    };
    return q;
  },
};

const BRAND_INFO = {
  accountTimezone: "America/Chicago",
  branding: {
    brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: "owner@rio.test",
  },
  fromEmail: "hello@rio.test", replyToEmail: "owner@rio.test", outboundSuppressed: false, mailingAddress: null,
};

const QREQ: QueueCancelNoticeRequest = {
  accountId: "acct_1", bookingId: "bk_1", userId: "user_1",
  locale: "en", message: "Our truck broke down. Sorry!", origin: "https://app.bis-rgv.com",
};

const order: string[] = [];
const sleep = vi.fn(async (ms: number) => { order.push(`sleep ${ms}`); });
const gated = () => vi.mocked(sendEmailOrThrow).mock.calls.map((c) => c[0]);

beforeEach(() => {
  order.length = 0;
  sleep.mockClear();
  db.rows.booking = {
    contact_id: "contact_1", calendar_id: "cal_1",
    starts_at: "2026-11-01T14:00:00Z", booker_timezone: "America/New_York",
  };
  db.rows.calendar = { public_id: "pub1", enabled: true };
  db.claimCancelNotice.mockReset().mockImplementation(async () => { order.push("claim"); return true; });
  db.getContact.mockReset().mockResolvedValue({ id: "contact_1", email: " maria@example.com ", first_name: "Maria" });
  db.ensureConversation.mockReset().mockResolvedValue({ id: "conv_1", created: false });
  db.createMessage.mockReset().mockImplementation(async () => { order.push("message"); return { id: "msg_1" }; });
  db.updateMessageStatus.mockReset().mockImplementation(async (_d, _a, _id, status) => { order.push(`mark ${status}`); });
  db.loadAccountBrandInfo.mockReset().mockImplementation(async () => new Map([["acct_1", BRAND_INFO]]));
  db.bookingContactEmail.mockReset().mockResolvedValue("Maria@Example.com");
  db.isAccountOutboundSuppressed.mockReset().mockResolvedValue(false);
  db.readEmailSuppression.mockReset().mockResolvedValue(null);
  db.discardQueuedNotice.mockReset().mockImplementation(async () => { order.push("discard"); return true; });
  db.readBookingStatus.mockReset().mockImplementation(async () => { order.push("read status"); return "cancelled"; });
  db.deletePendingCancelNotice.mockReset().mockImplementation(async () => { order.push("drop pending"); return true; });
  vi.mocked(sendEmailOrThrow).mockReset().mockImplementation(async () => { order.push("send"); return { providerMessageId: "re_1" }; });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cancelNoticeAvailability — can a notice go at all, known before anything is promised (F-048 M2)", () => {
  it("is available for a contact with an address, an account that sends, and an address that has not bounced", async () => {
    expect(await cancelNoticeAvailability(fakeDb as never, fakeDb as never, "acct_1", "bk_1")).toBe("available");
  });

  it("no address on file: no_email, and nothing else is read", async () => {
    db.bookingContactEmail.mockResolvedValue(null);
    expect(await cancelNoticeAvailability(fakeDb as never, fakeDb as never, "acct_1", "bk_1")).toBe("no_email");
    expect(db.readEmailSuppression).not.toHaveBeenCalled();
  });

  it("an account marked not to send (D-061): suppressed_account (mutation: drop the check → FAILS)", async () => {
    db.isAccountOutboundSuppressed.mockResolvedValue(true);
    expect(await cancelNoticeAvailability(fakeDb as never, fakeDb as never, "acct_1", "bk_1")).toBe("suppressed_account");
  });

  it("a hard bounce or complaint on the address: address_blocked, read exactly as the email gate reads it, keyed as the ledger keys it (mutation: skip the suppression read → FAILS)", async () => {
    db.readEmailSuppression.mockResolvedValue({ method: "hard_bounce", since: "2026-10-01T00:00:00Z", eventId: 7 });
    expect(await cancelNoticeAvailability(fakeDb as never, fakeDb as never, "acct_1", "bk_1")).toBe("address_blocked");
    expect(db.readEmailSuppression).toHaveBeenCalledWith(fakeDb, "acct_1", "maria@example.com");
  });

  it("a read that fails THROWS: the caller refuses rather than promise an email nobody checked", async () => {
    db.readEmailSuppression.mockRejectedValue(new Error("db down"));
    await expect(cancelNoticeAvailability(fakeDb as never, fakeDb as never, "acct_1", "bk_1")).rejects.toThrow("db down");
  });
});

describe("queueCancelNotice — the thread row is written QUEUED in the cancel itself (F-048 I2)", () => {
  it("composes the email and writes the outbound row as the person who cancelled, queued, before any wait (mutation: no row until the send → FAILS)", async () => {
    const queued = await queueCancelNotice(fakeDb as never, QREQ);
    expect(db.ensureConversation).toHaveBeenCalledWith(fakeDb, "acct_1", "contact_1", "user_1");
    const [, accountId, msg, actor] = db.createMessage.mock.calls[0]!;
    expect(accountId).toBe("acct_1");
    expect(actor).toBe("user_1");
    expect(msg).toMatchObject({ conversationId: "conv_1", channel: "email", direction: "outbound", subject: "Your booking has been cancelled" });
    // The row's status is the column default, queued: no status is passed.
    expect((msg as { status?: string }).status).toBeUndefined();
    expect(queued.messageId).toBe("msg_1");
    expect(queued.email).toMatchObject({
      contactId: "contact_1", to: "maria@example.com", fromName: "Rio Roofing",
      fromAddress: "hello@rio.test", replyTo: "owner@rio.test", subject: "Your booking has been cancelled", locale: "en",
    });
    expect(queued.email.text).toContain("Our truck broke down. Sorry!");
    // The booker's own zone first, the business's beside it.
    expect(queued.email.text).toMatch(/9:00 AM EST/);
    expect(queued.email.text).toMatch(/8:00 AM CST for us/);
    expect(queued.email.text).toContain("Book a new time: https://app.bis-rgv.com/b/pub1");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });

  it("speaks Spanish when the owner chose Spanish, the link to book again included", async () => {
    const { email } = await queueCancelNotice(fakeDb as never, { ...QREQ, locale: "es", message: "Lo sentimos." });
    expect(email).toMatchObject({ locale: "es", subject: "Tu cita fue cancelada" });
    expect(email.text).toContain("Tu cita fue cancelada.");
    expect(email.text).toContain("para nosotros");
    expect(email.text).toContain("Agendar otro horario: https://app.bis-rgv.com/b/pub1?locale=es");
  });

  it("offers no link to book again when the calendar is switched off", async () => {
    db.rows.calendar = { public_id: "pub1", enabled: false };
    expect((await queueCancelNotice(fakeDb as never, QREQ)).email.text).not.toContain("Book a new time");
  });

  it("THROWS when the contact has no address left, writing no row", async () => {
    db.getContact.mockResolvedValue({ id: "contact_1", email: null });
    await expect(queueCancelNotice(fakeDb as never, QREQ)).rejects.toThrow(/no email/);
    expect(db.createMessage).not.toHaveBeenCalled();
  });
});

const QUEUED: QueuedCancelNotice = {
  messageId: "msg_1",
  email: {
    contactId: "contact_1", to: "maria@example.com", locale: "en", fromName: "Rio Roofing",
    fromAddress: "hello@rio.test", replyTo: "owner@rio.test", origin: "https://app.bis-rgv.com",
    subject: "Your booking has been cancelled", text: "Your booking has been cancelled.", html: "<p>x</p>",
  },
};
const VERSION = "2026-10-09T18:00:00.123Z";
const WAIT = `sleep ${UNDO_WINDOW_MS + NOTICE_GRACE_MS}`;
const send = () => sendQueuedCancelNotice(
  { accountId: "acct_1", bookingId: "bk_1", version: VERSION, userId: "user_1", queued: QUEUED },
  { db: fakeDb as never, sleep },
);
const NOTICE: CancelNotice = {
  accountId: "acct_1", bookingId: "bk_1", version: VERSION, userId: "user_1",
  messageId: QUEUED.messageId, email: QUEUED.email,
};
const claimLost = () => db.claimCancelNotice.mockImplementation(async () => { order.push("claim"); return false; });
const bookingIs = (status: string | null) =>
  db.readBookingStatus.mockImplementation(async () => { order.push("read status"); return status; });

describe("sendQueuedCancelNotice — the customer hears only once the Undo has closed (F-048)", () => {
  it("waits out the window and its grace BEFORE claiming, then sends, marks the row sent and settles its pending row (mutation: claim before the sleep → FAILS)", async () => {
    expect(await send()).toBe("sent");
    expect(order).toEqual([WAIT, "claim", "send", "mark sent", "drop pending"]);
    expect(db.claimCancelNotice).toHaveBeenCalledWith(fakeDb, "acct_1", "bk_1", VERSION);
    expect(db.updateMessageStatus).toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "sent", { providerMessageId: "re_1" }, "user_1");
  });

  it("settles ONLY this cancel's pending row: by account, booking and this cancel's version (mutation: no delete after the send → the sweep finds a sent notice's row every tick, FAILS)", async () => {
    await send();
    expect(db.deletePendingCancelNotice).toHaveBeenCalledTimes(1);
    expect(db.deletePendingCancelNotice).toHaveBeenCalledWith(fakeDb, "acct_1", "bk_1", VERSION);
  });

  it("sends as the staff-typed cancel notice, to this contact, from the business (mutation: send as staff.composer_email → FAILS)", async () => {
    await send();
    expect(gated()[0]).toEqual({
      accountId: "acct_1", kind: "staff.booking_cancel_notice", contactId: "contact_1", language: "en",
      origin: "https://app.bis-rgv.com", to: "maria@example.com", fromName: "Rio Roofing",
      fromAddress: "hello@rio.test", replyTo: "owner@rio.test",
      subject: "Your booking has been cancelled", body: "Your booking has been cancelled.", html: "<p>x</p>",
    });
    expect(vi.mocked(sendEmailOrThrow).mock.calls[0]![1]).toEqual({ db: fakeDb });
  });

  it("an Undo that won (the claim is lost and the booking is no longer cancelled): nothing is sent and the queued row is removed (mutation: never discard on a lost claim → FAILS)", async () => {
    claimLost();
    bookingIs("booked");
    expect(await send()).toBe("undone");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(order).toEqual([WAIT, "claim", "read status", "discard", "drop pending"]);
    expect(db.discardQueuedNotice).toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1");
  });

  it("HAZARD (rule 4): the SWEEP won (the claim is lost and the booking is STILL cancelled): nothing is sent and the queued row is NOT discarded, because an email that went may sit behind it; only this cancel's pending row is settled (mutation: discard on every lost claim, as before the sweep → the sent email's record is deleted, FAILS)", async () => {
    claimLost();
    bookingIs("cancelled");
    expect(await send()).toBe("elsewhere");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(db.discardQueuedNotice).not.toHaveBeenCalled();
    expect(db.updateMessageStatus).not.toHaveBeenCalled();
    expect(order).toEqual([WAIT, "claim", "read status", "drop pending"]);
    expect(db.deletePendingCancelNotice).toHaveBeenCalledWith(fakeDb, "acct_1", "bk_1", VERSION);
  });

  it("a lost claim on a booking that is gone discards nothing: only an Undo PROVEN by the row's status removes the queued row (mutation: discard unless the status reads `cancelled` → FAILS)", async () => {
    claimLost();
    bookingIs(null);
    expect(await send()).toBe("elsewhere");
    expect(db.discardQueuedNotice).not.toHaveBeenCalled();
  });

  it("a lost claim whose status read fails touches NOTHING, the pending row included, so the sweep can settle it later (mutation: treat the read error as an Undo → the queued row is discarded, FAILS; drop the pending row anyway → nobody ever settles it, FAILS)", async () => {
    claimLost();
    db.readBookingStatus.mockRejectedValue(new Error("db down"));
    expect(await send()).toBe("unsettled");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(db.discardQueuedNotice).not.toHaveBeenCalled();
    expect(db.deletePendingCancelNotice).not.toHaveBeenCalled();
    expect(db.updateMessageStatus).not.toHaveBeenCalled();
  });

  it("a claimed notice whose send is refused or fails marks the row failed and settles its pending row: the claim is spent, nobody can send it now (mutation: no mark on failure → the row stays queued, FAILS)", async () => {
    vi.mocked(sendEmailOrThrow).mockRejectedValue(new Error("email not sent: suppressed"));
    expect(await send()).toBe("failed");
    expect(db.updateMessageStatus).toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "failed", { error: "email not sent: suppressed" }, "user_1");
    expect(db.deletePendingCancelNotice).toHaveBeenCalledWith(fakeDb, "acct_1", "bk_1", VERSION);
  });

  it("a claim that throws marks the row failed, sends nothing, and KEEPS the pending row: the claim may never have landed, and the sweep retries it under the same claim (mutation: settle the pending row on a claim error → FAILS)", async () => {
    db.claimCancelNotice.mockRejectedValue(new Error("db down"));
    expect(await send()).toBe("failed");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(db.updateMessageStatus).toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "failed", { error: "db down" }, "user_1");
    expect(db.deletePendingCancelNotice).not.toHaveBeenCalled();
  });

  it("M-c: an email that SENT stays sent: a failure marking the row sent is logged, never turned into failed (mutation: one try around send and mark → the row is marked failed, FAILS)", async () => {
    db.updateMessageStatus.mockImplementation(async (_d, _a, _id, status) => {
      order.push(`mark ${status}`);
      if (status === "sent") throw new Error("db down");
    });
    expect(await send()).toBe("sent");
    expect(order).toEqual([WAIT, "claim", "send", "mark sent", "drop pending"]);
    expect(db.updateMessageStatus).not.toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "failed", expect.anything(), "user_1");
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("sent, but");
  });

  it("an email that SENT stays sent when settling its pending row fails: logged, and the sweep's lost claim cleans it up later (mutation: settle inside the send's try → the row is marked failed, FAILS)", async () => {
    db.deletePendingCancelNotice.mockRejectedValue(new Error("db down"));
    expect(await send()).toBe("sent");
    expect(db.updateMessageStatus).not.toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "failed", expect.anything(), "user_1");
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("pending row not removed");
  });

  it("never throws, even when marking the row fails too, and logs no address", async () => {
    vi.mocked(sendEmailOrThrow).mockRejectedValue(new Error("provider down"));
    db.updateMessageStatus.mockRejectedValue(new Error("db down"));
    expect(await send()).toBe("failed");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("bk_1");
    expect(logged).not.toContain("maria@example.com");
  });
});

describe("deliverCancelNotice — the ONE delivery, shared by after() and the sweep", () => {
  it("sends through the sender it is handed (the cron tick's gate), never around it (mutation: always call sendEmailOrThrow → FAILS)", async () => {
    const tickSend = vi.fn(async () => ({ providerMessageId: "re_tick" }));
    expect(await deliverCancelNotice(NOTICE, { db: fakeDb as never, send: tickSend })).toBe("sent");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(tickSend).toHaveBeenCalledTimes(1);
    expect(tickSend.mock.calls[0]).toEqual([expect.objectContaining({ kind: "staff.booking_cancel_notice", to: "maria@example.com" })]);
    expect(db.updateMessageStatus).toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "sent", { providerMessageId: "re_tick" }, "user_1");
  });

  it("does not wait: the sweep calls it long after the window closed", async () => {
    await deliverCancelNotice(NOTICE, { db: fakeDb as never });
    expect(sleep).not.toHaveBeenCalled();
    expect(order).toEqual(["claim", "send", "mark sent", "drop pending"]);
  });
});

describe("expireCancelNotice — too late to tell the customer: never sent, said so on the thread", () => {
  const expire = (why: "started" | "too_old" = "started") => expireCancelNotice(NOTICE, { db: fakeDb as never }, why);

  it("claims first, sends nothing, marks the row failed in plain words and settles the pending row (mutation: send anyway → FAILS)", async () => {
    expect(await expire()).toBe("expired");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(order).toEqual(["claim", "mark failed", "drop pending"]);
    const [, , id, status, patch, actor] = db.updateMessageStatus.mock.calls[0]!;
    expect([id, status, actor]).toEqual(["msg_1", "failed", "user_1"]);
    expect((patch as { error: string }).error).toBe(CANCEL_NOTICE_EXPIRED.started);
    expect(CANCEL_NOTICE_EXPIRED.started).not.toBe(CANCEL_NOTICE_EXPIRED.too_old);
  });

  it("names why: an appointment already started, or a notice a day old", async () => {
    await expire("too_old");
    expect((db.updateMessageStatus.mock.calls[0]![4] as { error: string }).error).toBe(CANCEL_NOTICE_EXPIRED.too_old);
  });

  it("an Undo that won: the queued row is discarded, never marked failed (mutation: mark failed without claiming first → an undone cancel's thread says the email failed, FAILS)", async () => {
    claimLost();
    bookingIs("booked");
    expect(await expire()).toBe("undone");
    expect(db.updateMessageStatus).not.toHaveBeenCalled();
    expect(order).toEqual(["claim", "read status", "discard", "drop pending"]);
  });

  it("HAZARD (rule 4): someone else claimed it and the booking is still cancelled: the message is untouched, only the pending row goes (mutation: mark it failed anyway → a sent email reads failed, FAILS)", async () => {
    claimLost();
    bookingIs("cancelled");
    expect(await expire()).toBe("elsewhere");
    expect(db.updateMessageStatus).not.toHaveBeenCalled();
    expect(db.discardQueuedNotice).not.toHaveBeenCalled();
    expect(order).toEqual(["claim", "read status", "drop pending"]);
  });

  it("a claim that throws leaves everything for the next tick (mutation: mark failed on a claim error → FAILS)", async () => {
    db.claimCancelNotice.mockRejectedValue(new Error("db down"));
    expect(await expire()).toBe("unsettled");
    expect(db.updateMessageStatus).not.toHaveBeenCalled();
    expect(db.deletePendingCancelNotice).not.toHaveBeenCalled();
  });

  it("a failed mark is logged and the pending row still settles: the claim is spent, a retry could only lose it", async () => {
    db.updateMessageStatus.mockRejectedValue(new Error("db down"));
    expect(await expire()).toBe("expired");
    expect(db.deletePendingCancelNotice).toHaveBeenCalledWith(fakeDb, "acct_1", "bk_1", VERSION);
  });
});

/**
 * The notice waits inside the cancel's own server invocation (`after()`),
 * which ends at the function's maxDuration. On Vercel's Fluid compute the
 * default is already 300 s, so dropping the export would still work today:
 * this pin keeps the ceiling EXPLICIT, so a project-level change (Fluid off,
 * where the default falls far below the wait) cannot quietly cut the notice
 * off (ASSUMPTION: Vercel applies a page's `maxDuration` to the server
 * actions it serves and to `after()` work; not verified on a deployment from
 * this repo).
 */
describe("the Calendar page states its own ceiling, long enough for the notice", () => {
  it("names a maxDuration at least the wait plus 30 seconds (mutation: drop it → FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const declared = /^export const maxDuration = (\d+);$/m.exec(src);
    expect(declared, "page.tsx exports maxDuration").not.toBeNull();
    expect(Number(declared![1]) * 1000).toBeGreaterThanOrEqual(UNDO_WINDOW_MS + NOTICE_GRACE_MS + 30_000);
  });

  // F-048 follow-up (m2): the sweep reads a row only once it has been due for
  // CANCEL_NOTICE_SWEEP_SLACK_MS. If that point is past the page's own
  // ceiling, the after() job that queued the row has either settled it or
  // been killed by then, so a LIVE after() and the sweep never claim the same
  // notice in the ordinary course; the claim decides the rare overlap anyway.
  it("the sweep's first look at a row comes after the page's ceiling: window + grace + slack > maxDuration (mutation: maxDuration = 200, or a 30 s slack → FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { CANCEL_NOTICE_SWEEP_SLACK_MS } = await import("@/lib/automations/passes/cancel-notices");
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const declared = /^export const maxDuration = (\d+);$/m.exec(src);
    expect(declared, "page.tsx exports maxDuration").not.toBeNull();
    expect(UNDO_WINDOW_MS + NOTICE_GRACE_MS + CANCEL_NOTICE_SWEEP_SLACK_MS).toBeGreaterThan(Number(declared![1]) * 1000);
  });
});
