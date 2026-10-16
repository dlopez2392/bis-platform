import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ createMessage: vi.fn(), findMessageByProviderId: vi.fn(), incrementUnreadCount: vi.fn(), setInboundMessage: vi.fn() }));
vi.mock("@bis/db", () => db);
const stop = vi.hoisted(() => ({ recordInboundStop: vi.fn() }));
vi.mock("@/lib/consent/email-staff-actions", () => stop);
import { fileInboundEmail, type FileInput } from "./file";

const DB = { service: true } as never;
const ROW = {
  id: "ie_1", accountId: "acc", conversationId: "conv", providerEmailId: "re_1", fromEmail: "luis@example.com", fromName: "Luis",
  toEmail: "r-x@reply.bis-rgv.com", subject: "Re: Hi", text: "STOP", auth: { spf: "pass", dkim: "pass", dmarc: "pass", spam: "PASS", virus: "PASS" }, attachmentCount: 2,
  status: "filed" as const, holdReason: null, messageId: null, decidedBy: "email-inbound", decidedAt: "x", receivedAt: "2026-10-16T10:00:00.000Z",
};
const input = (over: Partial<FileInput> = {}): FileInput => ({
  row: ROW, contactId: "ana", sender: { contactId: "luis", firstName: "Luis", lastName: "Ruiz", viaGroup: true },
  attachmentCount: 2, raiseUnread: true, actor: { id: "email-inbound", type: "system" }, ...over,
});

beforeEach(() => {
  for (const f of [...Object.values(db), ...Object.values(stop)]) f.mockReset();
  db.findMessageByProviderId.mockResolvedValue(null);
  db.createMessage.mockResolvedValue({ id: "msg_1" });
  db.setInboundMessage.mockResolvedValue(true);
  stop.recordInboundStop.mockResolvedValue({ outcome: "stopped", eventId: "ev_1" });
});

describe("fileInboundEmail (spec Inbound step 5, 7)", () => {
  it("writes the stop FIRST, then the message with its facts, then raises unread (mutation: create the message before the ledger → a ledger failure leaves a message, FAILS the next case)", async () => {
    expect(await fileInboundEmail({ db: DB, now: () => new Date() }, input())).toEqual({ messageId: "msg_1", created: true, consent: { kind: "stopped", eventId: "ev_1" } });
    expect(stop.recordInboundStop).toHaveBeenCalledWith(DB, { accountId: "acc", contactId: "luis", address: "luis@example.com", providerEmailId: "re_1", phrase: "STOP" });
    expect(db.createMessage).toHaveBeenCalledWith(DB, "acc", {
      conversationId: "conv", channel: "email", direction: "inbound", status: "delivered", subject: "Re: Hi", body: "STOP",
      providerMessageId: "re_1",
      meta: { inbound_email_id: "re_1", attachment_count: 2, sender: { contact_id: "luis", first_name: "Luis", last_name: "Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } },
    }, "email-inbound", "system");
    expect(db.setInboundMessage).toHaveBeenCalledWith(DB, "acc", "ie_1", "msg_1");
    expect(db.incrementUnreadCount).toHaveBeenCalledWith(DB, "acc", "conv");
  });

  it("a ledger failure throws before any message (mutation: catch it → createMessage called, FAILS)", async () => {
    stop.recordInboundStop.mockRejectedValue(new Error("down"));
    await expect(fileInboundEmail({ db: DB, now: () => new Date() }, input())).rejects.toThrow(/down/);
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it("a retried delivery finds its message by Resend's id: no second message, no unread (mutation: skip the find → createMessage twice, FAILS)", async () => {
    db.findMessageByProviderId.mockResolvedValue({ id: "msg_0" });
    expect((await fileInboundEmail({ db: DB, now: () => new Date() }, input())).created).toBe(false);
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
  });

  it("an unclear stop writes nothing to the ledger and marks the message 'maybe'; a plain reply 'none'; the thread's own contact carries no sender (mutation: record unclear stops → FAILS)", async () => {
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "Please remove me" }, sender: { contactId: "ana", firstName: "Ana", lastName: null, viaGroup: false } }));
    expect(stop.recordInboundStop).not.toHaveBeenCalled();
    expect(db.createMessage.mock.calls[0]![2].meta).toEqual({ inbound_email_id: "re_1", attachment_count: 2, consent: { kind: "maybe", phrase: "remove me" } });
    db.createMessage.mockClear();
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }));
    expect(db.createMessage.mock.calls[0]![2].meta.consent).toEqual({ kind: "none" });
  });

  it("from Needs a look: unread not raised, the person is the actor, an unverified sender's stop is still heard (staff vouched; mutation: raise unread always → FAILS)", async () => {
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ raiseUnread: false, sender: null, actor: { id: "user_1", type: "user" } }));
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
    expect(stop.recordInboundStop).toHaveBeenCalledWith(DB, expect.objectContaining({ contactId: "ana" }));
    expect(db.createMessage.mock.calls[0]![3]).toBe("user_1");
  });

  it("an already-stopped address leaves the consent 'none' (G3; mutation: map already_stopped to stopped → FAILS)", async () => {
    stop.recordInboundStop.mockResolvedValue({ outcome: "already_stopped" });
    expect((await fileInboundEmail({ db: DB, now: () => new Date() }, input())).consent).toEqual({ kind: "none" });
  });
});
