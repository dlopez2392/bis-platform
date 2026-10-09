import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  claimCancelNotice: vi.fn(),
  getContact: vi.fn(),
  ensureConversation: vi.fn(),
  createMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
  loadAccountBrandInfo: vi.fn(),
  rows: { booking: null as unknown, calendar: null as unknown },
}));
vi.mock("@bis/db", () => ({
  claimCancelNotice: db.claimCancelNotice,
  getContact: db.getContact,
  ensureConversation: db.ensureConversation,
  createMessage: db.createMessage,
  updateMessageStatus: db.updateMessageStatus,
  loadAccountBrandInfo: db.loadAccountBrandInfo,
  serviceDb: () => { throw new Error("tests pass their own db"); },
}));
vi.mock("@/lib/consent/email-gate", () => ({ sendEmailOrThrow: vi.fn() }));

import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { sendCancelNoticeAfterUndo, type CancelNoticeRequest } from "./cancel-notice";
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

const REQ: CancelNoticeRequest = {
  accountId: "acct_1", bookingId: "bk_1", version: "2026-10-09T18:00:00.123Z", userId: "user_1",
  locale: "en", message: "Our truck broke down. Sorry!", origin: "https://app.bis-rgv.com",
};

const order: string[] = [];
const sleep = vi.fn(async (ms: number) => { order.push(`sleep ${ms}`); });
const run = (req: Partial<CancelNoticeRequest> = {}) =>
  sendCancelNoticeAfterUndo({ ...REQ, ...req }, { db: fakeDb as never, sleep });
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
  db.getContact.mockReset().mockResolvedValue({ id: "contact_1", email: "maria@example.com", first_name: "Maria" });
  db.ensureConversation.mockReset().mockResolvedValue({ id: "conv_1", created: false });
  db.createMessage.mockReset().mockImplementation(async () => { order.push("message"); return { id: "msg_1" }; });
  db.updateMessageStatus.mockReset().mockResolvedValue(undefined);
  db.loadAccountBrandInfo.mockReset().mockImplementation(async () => new Map([["acct_1", {
    accountTimezone: "America/Chicago",
    branding: {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null, replyToEmail: "owner@rio.test",
    },
    fromEmail: "hello@rio.test", replyToEmail: "owner@rio.test", outboundSuppressed: false, mailingAddress: null,
  }]]));
  vi.mocked(sendEmailOrThrow).mockReset().mockImplementation(async () => { order.push("send"); return { providerMessageId: "re_1" }; });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendCancelNoticeAfterUndo — the customer hears only once the Undo has closed (F-048)", () => {
  it("waits out the whole Undo window and its grace BEFORE claiming, then writes the thread row, then sends (mutation: claim before the sleep → FAILS)", async () => {
    expect(await run()).toBe("sent");
    expect(order).toEqual([`sleep ${UNDO_WINDOW_MS + NOTICE_GRACE_MS}`, "claim", "message", "send"]);
    expect(db.claimCancelNotice).toHaveBeenCalledWith(fakeDb, "acct_1", "bk_1", REQ.version);
  });

  it("an Undo that won sends nothing and writes nothing (mutation: ignore the claim's answer → FAILS)", async () => {
    db.claimCancelNotice.mockResolvedValue(false);
    expect(await run()).toBe("undone");
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it("sends as the staff-typed cancel notice, to this contact, from the business, in the owner's words (mutation: send as staff.composer_email → FAILS)", async () => {
    await run();
    const [req] = gated();
    expect(req).toMatchObject({
      accountId: "acct_1", kind: "staff.booking_cancel_notice", contactId: "contact_1", language: "en",
      origin: "https://app.bis-rgv.com", to: "maria@example.com", fromName: "Rio Roofing",
      fromAddress: "hello@rio.test", replyTo: "owner@rio.test",
      subject: "Your booking has been cancelled",
    });
    expect(req!.body).toContain("Our truck broke down. Sorry!");
    // The booker's own zone first, the business's beside it.
    expect(req!.body).toMatch(/9:00 AM EST/);
    expect(req!.body).toMatch(/8:00 AM CST for us/);
    expect(req!.body).toContain("Book a new time: https://app.bis-rgv.com/b/pub1");
    expect(vi.mocked(sendEmailOrThrow).mock.calls[0]![1]).toEqual({ db: fakeDb });
  });

  it("records the notice on the customer's thread as the person who cancelled, then marks it sent (provenance: a named person)", async () => {
    await run();
    expect(db.ensureConversation).toHaveBeenCalledWith(fakeDb, "acct_1", "contact_1", "user_1");
    const [, accountId, msg, actor] = db.createMessage.mock.calls[0]!;
    expect(accountId).toBe("acct_1");
    expect(actor).toBe("user_1");
    expect(msg).toMatchObject({ conversationId: "conv_1", channel: "email", direction: "outbound", subject: "Your booking has been cancelled" });
    expect(db.updateMessageStatus).toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "sent", { providerMessageId: "re_1" }, "user_1");
  });

  it("speaks Spanish when the owner chose Spanish, the link to book again included", async () => {
    await run({ locale: "es", message: "Lo sentimos." });
    const [req] = gated();
    expect(req).toMatchObject({ language: "es", subject: "Tu cita fue cancelada" });
    expect(req!.body).toContain("Tu cita fue cancelada.");
    expect(req!.body).toContain("para nosotros");
    expect(req!.body).toContain("Agendar otro horario: https://app.bis-rgv.com/b/pub1?locale=es");
  });

  it("offers no link to book again when the calendar is switched off", async () => {
    db.rows.calendar = { public_id: "pub1", enabled: false };
    await run();
    expect(gated()[0]!.body).not.toContain("Book a new time");
  });

  it("a contact with no email left: no claim, so the Undo still works, and nothing is sent", async () => {
    db.getContact.mockResolvedValue({ id: "contact_1", email: null });
    expect(await run()).toBe("no_email");
    expect(db.claimCancelNotice).not.toHaveBeenCalled();
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });

  it("an account marked not to send: no claim, no thread row, no send (D-061; mutation: drop the check → a failed row is written, FAILS)", async () => {
    db.loadAccountBrandInfo.mockImplementation(async () => new Map([["acct_1", {
      accountTimezone: "America/Chicago",
      branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
      fromEmail: null, replyToEmail: null, outboundSuppressed: true, mailingAddress: null,
    }]]));
    expect(await run()).toBe("suppressed");
    expect(db.claimCancelNotice).not.toHaveBeenCalled();
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });

  it("a refused or failed send marks the thread row failed and never throws (it runs after the response)", async () => {
    vi.mocked(sendEmailOrThrow).mockRejectedValue(new Error("email not sent: suppressed"));
    expect(await run()).toBe("failed");
    expect(db.updateMessageStatus).toHaveBeenCalledWith(fakeDb, "acct_1", "msg_1", "failed", { error: "email not sent: suppressed" }, "user_1");
  });

  it("a read that throws is logged and answered, never thrown, and logs no address", async () => {
    db.getContact.mockRejectedValue(new Error("db down"));
    expect(await run()).toBe("failed");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("bk_1");
    expect(logged).not.toContain("maria@example.com");
  });
});

/**
 * The notice waits inside the cancel's own server invocation (`after()`),
 * which ends at the route's maxDuration. Server actions run in the page's
 * function, so the Calendar page names a duration that outlasts the wait with
 * room for the reads and the send (ASSUMPTION: Vercel applies a page's
 * `maxDuration` to the server actions it serves and to `after()` work; not
 * verified on a deployment from this repo).
 */
describe("the Calendar page lives long enough for the notice", () => {
  it("names a maxDuration at least the wait plus 30 seconds (mutation: drop it → FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const declared = /^export const maxDuration = (\d+);$/m.exec(src);
    expect(declared, "page.tsx exports maxDuration").not.toBeNull();
    expect(Number(declared![1]) * 1000).toBeGreaterThanOrEqual(UNDO_WINDOW_MS + NOTICE_GRACE_MS + 30_000);
  });
});
