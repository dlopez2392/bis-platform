import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ findReplyThread: vi.fn(), matchSender: vi.fn(), recordInboundEmail: vi.fn() }));
vi.mock("@bis/db", () => db);
const file = vi.hoisted(() => ({ fileInboundEmail: vi.fn() }));
vi.mock("./file", () => file);
import { handleReceivedEmail, type PipelineDeps } from "./pipeline";

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
  for (const f of [...Object.values(db), ...Object.values(file), fetchEmail, forward, log]) f.mockReset();
  deps = { db: {} as never, fetchEmail, now: () => new Date("2026-10-16T10:00:05Z"), forward, log };
  fetchEmail.mockResolvedValue(EMAIL());
  db.findReplyThread.mockResolvedValue(THREAD);
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

  it("the account's own domain is accepted for its own token (mutation: accept only the BIS domain → FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ receivedFor: [`r-${T}@reply.rio.com`] }));
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
});
