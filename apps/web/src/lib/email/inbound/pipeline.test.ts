import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  findReplyThread: vi.fn(), matchSender: vi.fn(), recordInboundEmail: vi.fn(),
  findInboundEmailByProviderId: vi.fn(), getConversationSummary: vi.fn(),
  INBOUND_EMAIL_COLLISION: "INBOUND_EMAIL_COLLISION",
}));
vi.mock("@bis/db", () => db);
const file = vi.hoisted(() => ({ fileInboundEmail: vi.fn() }));
vi.mock("./file", () => file);
import { handleReceivedEmail, type PipelineDeps } from "./pipeline";
import { INBOUND_EMAIL_COLLISION } from "@bis/db";

const T = "0123456789abcdef01234567";
const SES_OK = "Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;\r\nX-SES-Spam-Verdict: PASS\r\nX-SES-Virus-Verdict: PASS";
const EMAIL = (over: Record<string, unknown> = {}) => ({
  id: "re_1", from: "Ana Ruiz <ana@gmail.com>", to: [`r-${T}@reply.bis-rgv.com`], receivedFor: [`r-${T}@reply.bis-rgv.com`],
  subject: "Re: Hi", text: "Sounds good\n\nOn Tue, Oct 14, 2026 at 3:00 PM Rio <crm@bis-rgv.com> wrote:\n> Hi", html: null,
  rawHeaders: SES_OK, attachmentCount: 0, receivedAt: "2026-10-16T10:00:00.000Z", ...over,
});
const THREAD = { conversationId: "conv", accountId: "acc", contactId: "ana", revoked: false, inboundDomain: "reply.rio.com" };
let deps: PipelineDeps;
const fetchEmail = vi.fn();
const forward = vi.fn();
const log = vi.fn();

beforeEach(() => {
  for (const f of [...Object.values(db), ...Object.values(file), fetchEmail, forward, log]) if (typeof f === "function" && "mockReset" in f) f.mockReset();
  deps = { db: {} as never, fetchEmail, now: () => new Date("2026-10-16T10:00:05Z"), forward, log };
  fetchEmail.mockResolvedValue(EMAIL());
  db.findReplyThread.mockResolvedValue(THREAD);
  db.findInboundEmailByProviderId.mockResolvedValue(null);
  db.getConversationSummary.mockResolvedValue({ id: "conv", contactId: "ana", contactFirstName: "Ana", contactLastName: "Ruiz", lastMessageAt: null, lastMessagePreview: null, unreadCount: 0, contactLanguage: null });
  db.matchSender.mockResolvedValue({ contactId: "ana", firstName: "Ana", lastName: "Ruiz", viaGroup: false });
  db.recordInboundEmail.mockImplementation(async (_db: unknown, r: Record<string, unknown>) => ({ row: { id: "ie_1", messageId: null, decidedAt: "x", ...r }, created: true }));
  file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
  forward.mockResolvedValue(undefined);
});

describe("handleReceivedEmail (spec 'Inbound', 'Failure behaviour')", () => {
  it("files an authenticated reply from the thread's customer: the row (with its attachment count), the new text, the message, the forward (mutation: store the full text → the quote is kept, FAILS; drop attachmentCount from the row → 0, FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ attachmentCount: 2 }));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({
      accountId: "acc", conversationId: "conv", providerEmailId: "re_1", fromEmail: "ana@gmail.com", fromName: "Ana Ruiz",
      toEmail: `r-${T}@reply.bis-rgv.com`, subject: "Re: Hi", text: "Sounds good", attachmentCount: 2, status: "filed", holdReason: null, decidedBy: "email-inbound",
      auth: { spf: "pass", dkim: "pass", dmarc: "pass", spam: "PASS", virus: "PASS" },
    });
    expect(file.fileInboundEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contactId: "ana", raiseUnread: true, attachmentCount: 2, actor: { id: "email-inbound", type: "system" } }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ contactId: "ana", senderName: "Ana Ruiz", attachmentCount: 2 }));
  });

  it("a household member's reply files on the thread, named (mutation: drop the sender → FAILS)", async () => {
    db.matchSender.mockResolvedValue({ contactId: "luis", firstName: "Luis", lastName: "Ruiz", viaGroup: true });
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(file.fileInboundEmail.mock.calls[0]![1].sender).toEqual({ contactId: "luis", firstName: "Luis", lastName: "Ruiz", viaGroup: true });
  });

  it("holds an authenticated stranger as not_on_record and an unauthenticated customer as unverified; no message, no forward (mutation: file a stranger → FAILS)", async () => {
    db.matchSender.mockResolvedValue(null);
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "held" });
    expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({ status: "held", holdReason: "not_on_record", decidedBy: null });
    db.matchSender.mockResolvedValue({ contactId: "ana", firstName: "Ana", lastName: null, viaGroup: false });
    fetchEmail.mockResolvedValue(EMAIL({ rawHeaders: SES_OK.replace("dmarc=pass", "dmarc=fail") }));
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(db.recordInboundEmail.mock.calls[1]![1]).toMatchObject({ status: "held", holdReason: "unverified" });
    fetchEmail.mockResolvedValue(EMAIL({ rawHeaders: null }));
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(db.recordInboundEmail.mock.calls[2]![1]).toMatchObject({ status: "held", holdReason: "unverified" });
    expect(file.fileInboundEmail).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("a duplicate delivery of a held row is 200 with no second row; of a filed row it re-runs the idempotent file step, no forward (mutation: return before filing a filed duplicate → a 503'd stop is lost, FAILS)", async () => {
    db.recordInboundEmail.mockResolvedValue({ row: { id: "ie_1", status: "held", holdReason: "not_on_record" }, created: false });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "duplicate" });
    expect(file.fileInboundEmail).not.toHaveBeenCalled();
    db.recordInboundEmail.mockResolvedValue({ row: { id: "ie_1", status: "filed", holdReason: null, conversationId: "conv", text: "STOP", fromEmail: "ana@gmail.com" }, created: false });
    file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: false, consent: { kind: "none" } });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "duplicate" });
    expect(file.fileInboundEmail).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
  });

  it("drops an unknown token, a revoked token, a foreign domain and a mail with no r- recipient: 200, nothing stored, one log line with no token (mutation: store a held row for a revoked token → FAILS)", async () => {
    const cases: [string, () => void][] = [
      ["unknown", () => db.findReplyThread.mockResolvedValue(null)],
      ["revoked", () => db.findReplyThread.mockResolvedValue({ ...THREAD, revoked: true })],
      ["foreign", () => fetchEmail.mockResolvedValue(EMAIL({ receivedFor: [`r-${T}@reply.other.com`], to: [] }))],
      ["none", () => fetchEmail.mockResolvedValue(EMAIL({ receivedFor: ["info@reply.bis-rgv.com"], to: [] }))],
    ];
    for (const [name, arrange] of cases) {
      log.mockClear(); db.recordInboundEmail.mockClear();
      arrange();
      expect(await handleReceivedEmail(deps, { email_id: "re_1" }), name).toEqual({ status: 200, result: "dropped" });
      expect(db.recordInboundEmail, name).not.toHaveBeenCalled();
      expect(log, name).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0]), name).not.toContain(T);
      db.findReplyThread.mockResolvedValue(THREAD); fetchEmail.mockResolvedValue(EMAIL());
    }
  });

  it("the account's own domain is accepted for its own token, with no BIS-domain address anywhere in the message to pass it by accident (mutation: accept only the BIS domain → FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ receivedFor: [`r-${T}@reply.rio.com`], to: [] }));
    expect((await handleReceivedEmail(deps, { email_id: "re_1" })).result).toBe("filed");
  });

  it("a fetch failure is 503 (Resend retries); a missing id is 200 dropped (mutation: 200 on a fetch failure → FAILS)", async () => {
    fetchEmail.mockRejectedValue(new Error("timeout"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "fetch_failed" });
    expect(await handleReceivedEmail(deps, {})).toEqual({ status: 200, result: "dropped" });
  });

  it("a ledger or write failure while filing is 503; a forward failure is logged and the filed message stands (mutation: await forward unguarded → 503, FAILS)", async () => {
    file.fileInboundEmail.mockRejectedValueOnce(new Error("append_consent_event failed"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "write_failed" });
    forward.mockRejectedValueOnce(new Error("provider down"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(String(log.mock.calls.at(-1)![0])).toMatch(/forward/);
  });

  it("an HTML-only email files its text (G11; mutation: store '' → FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ text: null, html: "<p>Yes &amp; thanks</p>" }));
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(db.recordInboundEmail.mock.calls[0]![1].text).toBe("Yes & thanks");
  });

  describe("fix round 1", () => {
    it("item 2: a null From holds as unverified instead of throwing (mutation: email.from.slice without the ?? fallback → FAILS)", async () => {
      fetchEmail.mockResolvedValue(EMAIL({ from: null as unknown as string }));
      const outcome = await handleReceivedEmail(deps, { email_id: "re_1" });
      expect(outcome).toEqual({ status: 200, result: "held" });
      expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({ fromEmail: "", holdReason: "unverified" });
    });

    it("item 5/6b: received_for names the thread even when to carries the business's own plain address (mutation: use only [...email.to] → FAILS)", async () => {
      fetchEmail.mockResolvedValue(EMAIL({ receivedFor: [`r-${T}@reply.bis-rgv.com`], to: ["hello@rio.example"] }));
      expect((await handleReceivedEmail(deps, { email_id: "re_1" })).result).toBe("filed");
      expect(db.recordInboundEmail.mock.calls[0]![1].toEmail).toBe(`r-${T}@reply.bis-rgv.com`);
    });

    it("item 5/6b: received_for and to name DIFFERENT threads — files on the envelope's thread, never to's (mutation: use only [...email.to] → FAILS)", async () => {
      const T2 = "fedcba9876543210fedcba9";
      const THREAD2 = { conversationId: "conv2", accountId: "acc2", contactId: "luis", revoked: false, inboundDomain: "reply.other.com" };
      db.findReplyThread.mockImplementation(async (_db: unknown, token: string) => (token === T ? THREAD : THREAD2));
      fetchEmail.mockResolvedValue(EMAIL({ receivedFor: [`r-${T}@reply.bis-rgv.com`], to: [`r-${T2}@reply.bis-rgv.com`] }));
      await handleReceivedEmail(deps, { email_id: "re_1" });
      expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({ accountId: "acc", conversationId: "conv" });
    });

    it("item 6d: an unparseable receivedAt falls back to now() instead of throwing (mutation: drop the fallback → FAILS)", async () => {
      fetchEmail.mockResolvedValue(EMAIL({ receivedAt: "not-a-date" }));
      await handleReceivedEmail(deps, { email_id: "re_1" });
      expect(db.recordInboundEmail.mock.calls[0]![1].receivedAt).toBe("2026-10-16T10:00:05.000Z");
    });

    it("item 6g: a dropped delivery names the account when a thread was found and then rejected (revoked / wrong domain), never for an unknown or missing token (mutation: never include the account id → FAILS)", async () => {
      db.findReplyThread.mockResolvedValue({ ...THREAD, revoked: true });
      await handleReceivedEmail(deps, { email_id: "re_1" });
      expect(String(log.mock.calls[0]![0])).toContain("acc");
      log.mockClear();
      db.findReplyThread.mockResolvedValue(null);
      await handleReceivedEmail(deps, { email_id: "re_1" });
      expect(String(log.mock.calls[0]![0])).not.toContain("account=");
    });

    it("item 6h: a retry that finally FILES (the row already existed, unfiled, from an earlier crash) reports filed, never duplicate (mutation: decide the result from the row's own created → FAILS)", async () => {
      db.recordInboundEmail.mockResolvedValue({ row: { id: "ie_1", accountId: "acc", conversationId: "conv", status: "filed", holdReason: null, fromEmail: "ana@gmail.com", messageId: null }, created: false });
      file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    });
  });

  describe("fix round 2 (item 1: the cross-account collision)", () => {
    const FOREIGN_ROW = {
      id: "ie_foreign", accountId: "other_acc", conversationId: "other_conv", providerEmailId: "re_1",
      fromEmail: "ana@gmail.com", fromName: "Ana Ruiz", toEmail: "x", subject: "x", text: "x",
      auth: { spf: null, dkim: null, dmarc: null, spam: null, virus: null }, attachmentCount: 0,
      status: "filed" as const, holdReason: null, messageId: "msg_other", decidedBy: "email-inbound", decidedAt: "x", receivedAt: "2026-10-16T10:00:00.000Z",
    };

    it("looked up BEFORE the recipient is resolved (mutation: resolve the recipient first → FAILS)", async () => {
      let lookupOrder = -1; let threadOrder = -1; let n = 0;
      db.findInboundEmailByProviderId.mockImplementation(async () => { lookupOrder = n++; return null; });
      db.findReplyThread.mockImplementation(async () => { threadOrder = n++; return THREAD; });
      await handleReceivedEmail(deps, { email_id: "re_1" });
      expect(lookupOrder).toBeGreaterThanOrEqual(0);
      expect(lookupOrder).toBeLessThan(threadOrder);
    });

    it("a row already stored under ANOTHER account is 200 dropped: no write, no filing, no account named either way (mutation: skip the lookup's account check → FAILS)", async () => {
      db.findInboundEmailByProviderId.mockResolvedValue(FOREIGN_ROW);
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "dropped" });
      expect(db.recordInboundEmail).not.toHaveBeenCalled();
      expect(file.fileInboundEmail).not.toHaveBeenCalled();
      expect(String(log.mock.calls[0]![0])).not.toMatch(/account=/); // neither account's id named
    });

    it("a row already stored under THIS account, still unlinked, finishes filing rather than re-recording (mutation: re-record instead of resuming → FAILS)", async () => {
      const row = { ...FOREIGN_ROW, accountId: "acc", conversationId: "conv", messageId: null };
      db.findInboundEmailByProviderId.mockResolvedValue(row);
      file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
      expect(db.recordInboundEmail).not.toHaveBeenCalled();
      expect(file.fileInboundEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ row, contactId: "ana" }));
    });

    it("a row already stored under THIS account, already linked, is 200 duplicate without re-filing (mutation: re-file an already-linked row → FAILS)", async () => {
      const row = { ...FOREIGN_ROW, accountId: "acc", conversationId: "conv", messageId: "msg_1" };
      db.findInboundEmailByProviderId.mockResolvedValue(row);
      // file.ts's own item-3 short-circuit (a real call, unmocked, would answer this for an already-
      // linked row): created false, no new matchSender needed — mirrored here since fileInboundEmail
      // itself is mocked in this file.
      file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: false, consent: { kind: "none" } });
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "duplicate" });
      expect(db.recordInboundEmail).not.toHaveBeenCalled();
      expect(file.fileInboundEmail).toHaveBeenCalledTimes(1); // still called — file.ts's own idempotency, not skipped here
      expect(db.matchSender).not.toHaveBeenCalled(); // row.messageId already set: no sender lookup needed
    });

    it("the retry-after-503 orphan: a filed, unlinked row from an earlier attempt resumes and completes even though the recipient no longer resolves this time (mutation: drop the orphan instead of resuming → FAILS)", async () => {
      db.findReplyThread.mockResolvedValue(null); // the recipient no longer resolves on this retry
      const row = { ...FOREIGN_ROW, accountId: "acc", conversationId: "conv", messageId: null };
      db.findInboundEmailByProviderId.mockResolvedValue(row);
      db.getConversationSummary.mockResolvedValue({ id: "conv", contactId: "ana", contactFirstName: "Ana", contactLastName: "Ruiz", lastMessageAt: null, lastMessagePreview: null, unreadCount: 0, contactLanguage: null });
      file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
      expect(file.fileInboundEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ row, contactId: "ana" }));
    });

    it("an orphan whose row is HELD (never filed) is still dropped on this retry — only a FILED orphan resumes (mutation: resume a held orphan too → FAILS)", async () => {
      db.findReplyThread.mockResolvedValue(null);
      db.findInboundEmailByProviderId.mockResolvedValue({ ...FOREIGN_ROW, accountId: "acc", status: "held", holdReason: "not_on_record", messageId: null });
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "dropped" });
      expect(file.fileInboundEmail).not.toHaveBeenCalled();
    });

    it("recordInboundEmail's own cross-account throw (a race between this call's lookup and its insert) is 200 dropped, never a 503 retry loop (mutation: treat every recordInboundEmail throw as 503 → FAILS)", async () => {
      db.recordInboundEmail.mockRejectedValue(new Error(`recordInboundEmail: ${INBOUND_EMAIL_COLLISION} (provider_email_id re_1 outside account acc)`));
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "dropped" });
    });

    it("fix round 3 item 3: the collision catch is narrowed to the recordInboundEmail call only — a matchSender error containing the marker's phrase (coincidence, not the real throw) is still a plain 503, never dropped (mutation: widen the catch to the whole try block → FAILS)", async () => {
      db.matchSender.mockRejectedValue(new Error(`matchSender timed out, mentions ${INBOUND_EMAIL_COLLISION} only in passing`));
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "write_failed" });
      expect(db.recordInboundEmail).not.toHaveBeenCalled();
    });

    it("fix round 3 item 2: a same-account existing row's contact comes from ITS OWN conversation, never the thread this delivery's recipient resolves to (mutation: use the newly resolved thread's contactId → FAILS)", async () => {
      const row = { ...FOREIGN_ROW, accountId: "acc", conversationId: "other_conv_same_account", messageId: null };
      db.findInboundEmailByProviderId.mockResolvedValue(row);
      db.getConversationSummary.mockImplementation(async (_db: unknown, _accountId: string, conversationId: string) =>
        (conversationId === "other_conv_same_account"
          ? { id: conversationId, contactId: "luis", contactFirstName: "Luis", contactLastName: "Ruiz", lastMessageAt: null, lastMessagePreview: null, unreadCount: 0, contactLanguage: null }
          : { id: conversationId, contactId: "ana", contactFirstName: "Ana", contactLastName: "Ruiz", lastMessageAt: null, lastMessagePreview: null, unreadCount: 0, contactLanguage: null }));
      file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
      await handleReceivedEmail(deps, { email_id: "re_1" });
      expect(file.fileInboundEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contactId: "luis" }));
      expect(forward).toHaveBeenCalledWith(expect.objectContaining({ contactId: "luis" }));
    });

    it("the lookup failing outright is still a 503 (Resend retries), distinct from a genuine collision (mutation: swallow the lookup's own error too → FAILS)", async () => {
      db.findInboundEmailByProviderId.mockRejectedValue(new Error("db down"));
      expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "write_failed" });
    });
  });
});
