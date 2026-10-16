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

  it("a fully duplicate delivery (the row's own messageId already set) answers from the row alone: no re-classification, no lookup, no write, no unread (fix round 1 item 3; mutation: ignore row.messageId and look it up anyway → FAILS)", async () => {
    const result = await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, messageId: "msg_0" } }));
    expect(result).toEqual({ messageId: "msg_0", created: false, consent: { kind: "none" } });
    expect(stop.recordInboundStop).not.toHaveBeenCalled();
    expect(db.findMessageByProviderId).not.toHaveBeenCalled();
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
    expect(db.setInboundMessage).not.toHaveBeenCalled();
  });

  describe("fix round 1 item 3: a retry after a mid-flight failure decides 'first completion' from row.messageId, never from whether THIS call inserted the message", () => {
    it("setInboundMessage throws, then a retry with the SAME unlinked row finds the message already there and still raises unread and reports created (mutation: gate the retry's raise on this call's own insert → FAILS)", async () => {
      // Attempt 1: message created, but the link write fails — propagates before any retry logic here.
      db.setInboundMessage.mockRejectedValueOnce(new Error("link write failed"));
      await expect(fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }))).rejects.toThrow(/link write failed/);
      expect(db.createMessage).toHaveBeenCalledTimes(1);
      expect(db.incrementUnreadCount).toHaveBeenCalledTimes(1);

      // Retry: the SAME row (messageId still null — the DB write never committed), the message now
      // found by provider id (it was really inserted on attempt 1).
      db.findMessageByProviderId.mockResolvedValue({ id: "msg_1" });
      db.setInboundMessage.mockResolvedValue(true);
      const result = await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }));
      expect(result).toEqual({ messageId: "msg_1", created: true, consent: { kind: "none" } });
      expect(db.createMessage).toHaveBeenCalledTimes(1); // never a second message
      expect(db.incrementUnreadCount).toHaveBeenCalledTimes(2); // double raise on a crash is accepted
      expect(db.setInboundMessage).toHaveBeenLastCalledWith(DB, "acc", "ie_1", "msg_1");
    });

    it("incrementUnreadCount itself throws, then a retry with the SAME unlinked row still commits the link and reports created (mutation: skip the retry's raise because the message already exists → FAILS)", async () => {
      db.incrementUnreadCount.mockRejectedValueOnce(new Error("unread write failed"));
      await expect(fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }))).rejects.toThrow(/unread write failed/);
      expect(db.setInboundMessage).not.toHaveBeenCalled(); // never reached: unread threw first

      db.findMessageByProviderId.mockResolvedValue({ id: "msg_1" });
      const result = await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }));
      expect(result).toEqual({ messageId: "msg_1", created: true, consent: { kind: "none" } });
      expect(db.createMessage).toHaveBeenCalledTimes(1);
      expect(db.setInboundMessage).toHaveBeenCalledTimes(1);
    });

    it("createMessage itself throws (its own emit failed after a real insert), then a retry finds the orphaned message and still completes once (mutation: treat the retry's find as a fresh insert → a second message, FAILS)", async () => {
      db.createMessage.mockRejectedValueOnce(new Error("message.created emit failed"));
      await expect(fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }))).rejects.toThrow(/emit failed/);
      expect(db.incrementUnreadCount).not.toHaveBeenCalled();

      // Retry: the orphaned insert is now found by provider id.
      db.findMessageByProviderId.mockResolvedValue({ id: "msg_1" });
      const result = await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }));
      expect(result).toEqual({ messageId: "msg_1", created: true, consent: { kind: "none" } });
      expect(db.createMessage).toHaveBeenCalledTimes(1); // the first (failed) attempt only
      expect(db.incrementUnreadCount).toHaveBeenCalledTimes(1);
      expect(db.setInboundMessage).toHaveBeenCalledTimes(1);
    });
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
