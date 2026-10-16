import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { AutomationLogRow, Branding, DocumentRequestRow, DocumentRequestTarget, SupabaseClient } from "@bis/db";
import type { SmsRequest, SmsSendOptions, SmsSendResult } from "@/lib/consent/gate";
import type { EmailRequest, EmailSendResult } from "@/lib/consent/email-gate";
import type { PassContext } from "@/lib/automations/context";

/**
 * A document request's delivery (spec 4.2; plan deviation 11). The gates and the database are faked
 * at their module boundary; every fake writes to ONE call log so the order of the writes against the
 * provider is what the tests read. The SMS gate fake is faithful to gate.ts's own order: a deferral or
 * a refusal answers BEFORE `prepare`; a cleared send runs `prepare` (a throw there is
 * `failed`/`prepare` and nothing leaves), then the provider.
 */
const h = vi.hoisted(() => {
  const calls: string[] = [];
  const store = { sentAt: null as string | null };
  return {
    calls, store,
    smsAnswer: { value: null as unknown },
    emailAnswer: { value: null as unknown },
    sendSms: vi.fn(),
    sendEmail: vi.fn(),
    smsRecipientState: vi.fn(),
    resolveSmsSender: vi.fn(),
    recordUsageSafely: vi.fn(),
    documentRequestTarget: vi.fn(),
    getBranding: vi.fn(),
    getSendingIdentity: vi.fn(),
    readAccountTimezone: vi.fn(),
    ensureConversation: vi.fn(),
    createMessage: vi.fn(),
    updateMessageStatus: vi.fn(),
    recordAutomationLog: vi.fn(),
    getDocumentRequest: vi.fn(),
    claimDocumentRequestSend: vi.fn(),
    clearDocumentRequestSend: vi.fn(),
    writeHeld: vi.fn(),
    logSkipped: vi.fn(),
  };
});

vi.mock("@/lib/consent/gate", () => ({ sendSms: (...a: unknown[]) => h.sendSms(...a) }));
vi.mock("@/lib/consent/email-gate", () => ({ sendEmail: (...a: unknown[]) => h.sendEmail(...a) }));
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: (...a: unknown[]) => h.smsRecipientState(...a) }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => h.resolveSmsSender(...a) }));
vi.mock("@/lib/billing/usage", () => ({ recordUsageSafely: (...a: unknown[]) => h.recordUsageSafely(...a) }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  documentRequestTarget: (...a: unknown[]) => h.documentRequestTarget(...a),
  getBranding: (...a: unknown[]) => h.getBranding(...a),
  getSendingIdentity: (...a: unknown[]) => h.getSendingIdentity(...a),
  readAccountTimezone: (...a: unknown[]) => h.readAccountTimezone(...a),
  ensureConversation: (...a: unknown[]) => h.ensureConversation(...a),
  createMessage: (...a: unknown[]) => h.createMessage(...a),
  updateMessageStatus: (...a: unknown[]) => h.updateMessageStatus(...a),
  recordAutomationLog: (...a: unknown[]) => h.recordAutomationLog(...a),
  getDocumentRequest: (...a: unknown[]) => h.getDocumentRequest(...a),
  claimDocumentRequestSend: (...a: unknown[]) => h.claimDocumentRequestSend(...a),
  clearDocumentRequestSend: (...a: unknown[]) => h.clearDocumentRequestSend(...a),
}));
vi.mock("@/lib/automations/hold-or-send", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  writeHeld: (...a: unknown[]) => h.writeHeld(...a),
  logSkipped: (...a: unknown[]) => h.logSkipped(...a),
}));

import { deliverDocumentRequest, requestChannels, releaseDocumentRequest } from "./deliver";
import { requestToken } from "./token";
import { SMS_KINDS, EMAIL_KINDS } from "@/lib/consent/classes";
import { BLOCK_REASONS, EMAIL_BLOCK_REASONS, REASONS } from "@/lib/automations/hold-or-send";
import { withTrailingLink } from "@/lib/automations/sms-link";
import { documentRequestEmail } from "@/lib/email/templates/document-request";
import { emailBrand } from "@/lib/email/templates/shell";

const db = { tag: "service-db" } as unknown as SupabaseClient;
const ledger = { tag: "ledger-db" } as unknown as SupabaseClient;
const ACCT = "acct-1";
const REQ_ID = "2b1f7d7e-5b1c-4c55-9a43-6f0f1b2c3d4e";
const ACTOR = "user_staff_1";
const ORIGIN = "https://app.example.com";
const NOW = new Date("2026-10-15T15:00:00.000Z");
const ZONE = "America/Chicago";
const SECRET = "s3cret-s3cret-s3cret-s3cret-0032";

const request = (over: Partial<DocumentRequestRow> = {}): DocumentRequestRow => ({
  id: REQ_ID, account_id: ACCT, contact_id: "contact-1", client_group_id: null,
  items: [{ key: "insurance", category: "insurance", note: null }, { key: "other", category: "other", note: "Pool permit" }],
  language: "es", channel: "text", created_by: ACTOR, created_at: "2026-10-15T14:00:00.000Z",
  expires_at: "2026-10-22T14:00:00.000Z", revoked_at: null, revoked_by: null, completed_at: null, sent_at: null,
  ...over,
});
// The CONTACT's language is English and the request's Spanish: the request's wins (one message, one language).
const target = (over: Partial<DocumentRequestTarget> = {}): DocumentRequestTarget => ({
  name: "Ana Ruiz", contactId: "contact-1", language: "en", phone: "(956) 555-0123", email: "ana@example.com",
  phoneCountryUnconfirmed: false, ...over,
});
const branding: Branding = {
  brandName: "Casa Verde", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null,
  brandType: null, brandMode: null, replyToEmail: "office@casaverde.example",
};
const sentSms = (over: Partial<Extract<SmsSendResult, { kind: "sent" }>> = {}): SmsSendResult => ({
  kind: "sent", providerMessageId: "tx-msg-1", to: "+19565550123", from: "+19565550000", body: "x", billable: true, segments: 2, ...over,
});
const url = () => `${ORIGIN}/d/${requestToken(REQ_ID)}`;
const deliver = (over: Partial<Parameters<typeof deliverDocumentRequest>[1]> = {}) =>
  deliverDocumentRequest(db, { request: request(), channel: "text", actorId: ACTOR, origin: ORIGIN, now: NOW, ...over });
const logged = () => h.recordAutomationLog.mock.calls.map((c) => c[1] as Record<string, unknown>);

let errSpy: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  vi.stubEnv("DOCUMENT_LINK_SECRET", SECRET);
  h.calls.length = 0;
  h.store.sentAt = null;
  for (const f of Object.values(h)) if (typeof f === "function" && "mockReset" in f) (f as ReturnType<typeof vi.fn>).mockReset();
  h.smsAnswer.value = sentSms();
  h.emailAnswer.value = { kind: "sent", providerMessageId: "re-msg-1" } satisfies EmailSendResult;

  // The gate, faithful to gate.ts's order (see the file's comment).
  h.sendSms.mockImplementation(async (_db: SupabaseClient, req: SmsRequest, opts: SmsSendOptions = {}) => {
    h.calls.push("gate:sms");
    const answer = h.smsAnswer.value as SmsSendResult;
    if (answer.kind === "deferred" || answer.kind === "blocked") return answer;
    if (answer.kind === "failed" && answer.stage === "provider_unavailable") return answer;
    try {
      await opts.prepare?.({ body: `${req.body}\n\nResponda STOP para no recibir más mensajes.`, to: "+19565550123", from: "+19565550000" });
    } catch (e) {
      return { kind: "failed", stage: "prepare", error: e instanceof Error ? e.message : String(e), carrierBlocked: false };
    }
    h.calls.push("provider:sms");
    return answer;
  });
  h.sendEmail.mockImplementation(async () => {
    h.calls.push("gate:email");
    const answer = h.emailAnswer.value as EmailSendResult;
    if (answer.kind === "sent") h.calls.push("provider:email");
    return answer;
  });
  h.documentRequestTarget.mockImplementation(async () => target());
  h.getBranding.mockResolvedValue(branding);
  h.getSendingIdentity.mockResolvedValue({ fromEmail: "hola@casaverde.example" });
  h.readAccountTimezone.mockResolvedValue(ZONE);
  h.ensureConversation.mockImplementation(async () => { h.calls.push("ensureConversation"); return { id: "convo-1", created: false }; });
  h.createMessage.mockImplementation(async (_db: unknown, _a: unknown, input: { channel: string }) => { h.calls.push(`createMessage:${input.channel}`); return { id: "msg-1" }; });
  h.updateMessageStatus.mockImplementation(async (_db: unknown, _a: unknown, _id: unknown, status: string) => { h.calls.push(`status:${status}`); });
  h.recordAutomationLog.mockImplementation(async (_db: unknown, w: { status: string }) => { h.calls.push(`log:${w.status}`); });
  h.recordUsageSafely.mockImplementation(async () => { h.calls.push("usage"); });
  h.writeHeld.mockImplementation(async () => { h.calls.push("writeHeld"); });
  h.logSkipped.mockImplementation(async () => { h.calls.push("logSkipped"); });
  // The at-most-once stamp, stateful over ONE in-memory request row (re-review R1).
  h.claimDocumentRequestSend.mockImplementation(async (_db: unknown, _a: unknown, _id: unknown, now: Date) => {
    h.calls.push("claim");
    if (h.store.sentAt !== null) return false;
    h.store.sentAt = now.toISOString();
    return true;
  });
  h.clearDocumentRequestSend.mockImplementation(async () => { h.calls.push("clear"); h.store.sentAt = null; });
  h.getDocumentRequest.mockImplementation(async () => request({ sent_at: h.store.sentAt }));
  h.resolveSmsSender.mockResolvedValue({ ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] });
  h.smsRecipientState.mockResolvedValue({ kind: "ok" });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errSpy.mockRestore();
});

describe("deliverDocumentRequest by text", () => {
  it("1. hands the gate the informational kind, the target's phone, the REQUEST's language (not the contact's), the account's zone and the Spanish body with the link on the end (mutations: the contact's language -> FAILS; a staff_typed kind -> FAILS)", async () => {
    await deliver();
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    const [usedDb, req] = h.sendSms.mock.calls[0] as [SupabaseClient, SmsRequest];
    expect(usedDb).toBe(db);
    expect(req.kind).toBe("staff.document_request_sms");
    expect(SMS_KINDS[req.kind]).toEqual({ class: "informational", hours: "automated", footer: "stop_line" });
    expect(req.to).toBe("(956) 555-0123");
    expect(req.language).toBe("es");
    expect(req.accountZone).toBe(ZONE);
    expect(req.contactId).toBe("contact-1");
    expect(req.now).toBe(NOW);
    expect(req.body).toBe(withTrailingLink("Casa Verde: por favor envíenos Seguro, Pool permit. Súbalos aquí:", url()));
  });

  it("2. sent: the claim, the conversation and the message row are written BEFORE the provider, with the staff member as author (person mark); then the status with the provider id, usage, and What went out (mutation: write the row after the send -> FAILS)", async () => {
    const out = await deliver();
    expect(out).toEqual({ kind: "sent" });
    expect(h.calls).toEqual(["gate:sms", "claim", "ensureConversation", "createMessage:sms", "provider:sms", "status:sent", "usage", "log:sent"]);
    expect(h.ensureConversation).toHaveBeenCalledWith(db, ACCT, "contact-1", ACTOR);
    expect(h.createMessage).toHaveBeenCalledWith(db, ACCT, {
      conversationId: "convo-1", channel: "sms", direction: "outbound",
      body: `${withTrailingLink("Casa Verde: por favor envíenos Seguro, Pool permit. Súbalos aquí:", url())}\n\nResponda STOP para no recibir más mensajes.`,
    }, ACTOR);
    expect(h.updateMessageStatus).toHaveBeenCalledWith(db, ACCT, "msg-1", "sent", { providerMessageId: "tx-msg-1" }, ACTOR);
    expect(h.recordUsageSafely).toHaveBeenCalledWith(db, {
      accountId: ACCT, meter: "sms", quantity: 2, occurredAt: NOW, sourceRef: "message:msg-1",
    }, `document request ${REQ_ID}`);
    expect(logged()).toEqual([{
      accountId: ACCT, source: "document_request", channel: "sms", subjectKey: `document_request:${REQ_ID}`,
      contactId: "contact-1", payload: { channel: "text", actorId: ACTOR }, status: "sent",
    }]);
    expect(h.store.sentAt).toBe(NOW.toISOString());
  });

  it("2b. a send that does not bill records no usage (mutation: record usage unconditionally -> FAILS)", async () => {
    h.smsAnswer.value = sentSms({ billable: false });
    expect(await deliver()).toEqual({ kind: "sent" });
    expect(h.recordUsageSafely).not.toHaveBeenCalled();
  });

  it("3. deferred (quiet hours): HELD with the subject and its payload, the gate's own until and zone; no conversation or message row (mutation: write the message row before the hold -> FAILS)", async () => {
    const until = new Date("2026-10-16T13:00:00.000Z");
    h.smsAnswer.value = { kind: "deferred", until, zone: ZONE };
    const out = await deliver();
    expect(out).toEqual({ kind: "held", until: until.toISOString(), zone: ZONE });
    expect(h.writeHeld).toHaveBeenCalledWith({ db }, {
      accountId: ACCT, source: "document_request", channel: "sms", subjectKey: `document_request:${REQ_ID}`,
      contactId: "contact-1", payload: { channel: "text", actorId: ACTOR },
    }, until, ZONE);
    expect(h.ensureConversation).not.toHaveBeenCalled();
    expect(h.createMessage).not.toHaveBeenCalled();
    expect(h.store.sentAt).toBeNull();
  });

  it.each([
    ["stopped", BLOCK_REASONS.stopped, "documents.request.reason.textsStopped"],
    ["held", BLOCK_REASONS.held, "documents.request.reason.textsHeld"],
    ["a2p_not_approved", BLOCK_REASONS.a2p_not_approved, "documents.request.reason.textSetup"],
    ["no_live_number", BLOCK_REASONS.no_live_number, "documents.request.reason.textSetup"],
    // gate.ts step 2: `no_number` means the DESTINATION is not textable, so it is the no-phone line.
    ["no_number", BLOCK_REASONS.no_number, "documents.request.reason.noPhone"],
    ["unconfirmed_number", BLOCK_REASONS.unconfirmed_number, "documents.request.reason.noPhone"],
    ["suppressed_account", BLOCK_REASONS.suppressed_account, "documents.request.reason.failed"],
  ] as const)("4. blocked %s: skipped in What went out with the Activity page's words, and the dialog's reason (mutation: swap any one mapping -> FAILS)", async (reason, logReason, key) => {
    h.smsAnswer.value = { kind: "blocked", reason };
    const out = await deliver();
    expect(out).toEqual({ kind: "blocked", reason: key });
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: logReason, source: "document_request", channel: "sms" })]);
    expect(h.createMessage).not.toHaveBeenCalled();
    expect(h.writeHeld).not.toHaveBeenCalled();
  });

  it("4b. blocked ledger_unavailable is an outage, not an answer: held 15 minutes with the ledger-retry line, the text-back's rule (mutation: treat it as a refusal and skip -> FAILS)", async () => {
    h.smsAnswer.value = { kind: "blocked", reason: "ledger_unavailable" };
    const out = await deliver();
    const until = new Date(NOW.getTime() + 15 * 60_000);
    expect(out).toEqual({ kind: "held", until: until.toISOString(), zone: "UTC" });
    expect(h.writeHeld).toHaveBeenCalledWith({ db }, expect.objectContaining({ subjectKey: `document_request:${REQ_ID}` }), until, "UTC", REASONS.ledgerRetry);
    expect(logged()).toEqual([]);
  });

  it.each([
    ["no phone", target({ phone: null })],
    ["a number that cannot be texted", target({ phone: "12" })],
    ["no target at all (a household with no primary contact)", null],
  ])("5. %s: no gate call; skipped with the no-phone line (mutation: hand the gate a null number -> FAILS)", async (_label, t) => {
    h.documentRequestTarget.mockResolvedValue(t);
    const out = await deliver();
    expect(out).toEqual({ kind: "blocked", reason: "documents.request.reason.noPhone" });
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: REASONS.noPhone })]);
  });

  it("7. nothing throws out: a gate that rejects answers failed, logs by request id, and the log carries neither the token nor the link (mutation: rethrow -> FAILS)", async () => {
    h.sendSms.mockRejectedValue(new Error("resolveSmsSender failed: connection reset"));
    const out = await deliver();
    expect(out).toEqual({ kind: "failed" });
    const lines = errSpy.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes(REQ_ID))).toBe(true);
    for (const l of lines) {
      expect(l).not.toContain(requestToken(REQ_ID));
      expect(l).not.toContain("/d/");
    }
    expect(logged()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
  });

  it("7b. a missing link key is a failed delivery, never a throw, and nothing is sent", async () => {
    vi.stubEnv("DOCUMENT_LINK_SECRET", "");
    expect(await deliver()).toEqual({ kind: "failed" });
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it("failed at the provider: the row is marked failed, What went out says failed, and the stamp is CLEARED so a later send may try (mutation: no clear -> FAILS)", async () => {
    h.smsAnswer.value = { kind: "failed", stage: "provider", error: "500", carrierBlocked: false };
    const out = await deliver();
    expect(out).toEqual({ kind: "failed" });
    // M3: the provider's error on the row, as the composer's failed write carries it.
    expect(h.updateMessageStatus).toHaveBeenCalledWith(db, ACCT, "msg-1", "failed", { error: "500" }, ACTOR);
    expect(h.store.sentAt).toBeNull();
    expect(h.calls).toContain("clear");
    expect(logged()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
  });

  it("M3. a failed-status write that rejects is logged by request id and still answers failed (mutation: swallow it silently -> FAILS)", async () => {
    h.smsAnswer.value = { kind: "failed", stage: "provider", error: "500", carrierBlocked: false };
    h.updateMessageStatus.mockRejectedValue(new Error("status down"));
    expect(await deliver()).toEqual({ kind: "failed" });
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes(REQ_ID) && l.includes("failed status was not written"))).toHaveLength(1);
  });

  it("I1. the direct (staff) path is unchanged: a branding read error, a gate throw or a re-hold that cannot be written answers failed and writes the failed row (mutation: rethrow on the direct path -> FAILS)", async () => {
    h.getBranding.mockRejectedValueOnce(new Error("branding down"));
    expect(await deliver()).toEqual({ kind: "failed" });
    h.sendSms.mockRejectedValueOnce(new Error("gate down"));
    expect(await deliver()).toEqual({ kind: "failed" });
    h.smsAnswer.value = { kind: "deferred", until: new Date("2026-10-16T13:00:00.000Z"), zone: ZONE };
    h.writeHeld.mockRejectedValueOnce(new Error("hold down"));
    expect(await deliver()).toEqual({ kind: "failed" });
    expect(logged()).toEqual([
      expect.objectContaining({ status: "failed", reason: REASONS.failed }),
      expect.objectContaining({ status: "failed", reason: REASONS.failed }),
      expect.objectContaining({ status: "failed", reason: REASONS.failed }),
    ]);
  });

  it("10. after a successful send nothing turns it into failed: the status write AND the log write both reject, the answer is still sent, usage is still recorded, and both failures are logged by request id (plan review I4; mutation: let either rejection reach the outer catch -> FAILS)", async () => {
    h.updateMessageStatus.mockRejectedValue(new Error("status write down"));
    h.recordAutomationLog.mockRejectedValue(new Error("log write down"));
    const out = await deliver();
    expect(out).toEqual({ kind: "sent" });
    expect(h.recordUsageSafely).toHaveBeenCalledTimes(1);
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes(REQ_ID) && l.includes("status was not written"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes(REQ_ID) && l.includes("What went out not written (sent)"))).toHaveLength(1);
    expect(h.store.sentAt).toBe(NOW.toISOString());
  });
});

describe("no brand name (fix round 2): whole sentences, never 'the business'/'el negocio' filled in", () => {
  const noName: Branding = { ...branding, brandName: null };
  it.each([
    ["es", `Le pedimos Seguro, Pool permit. Puede subirlos en este enlace:`],
    ["en", `Please send us Insurance, Pool permit. Upload them here:`],
  ] as const)("the text in %s is the no-name sentence with the link on the end (mutation: always use the {business} key -> FAILS)", async (language, lead) => {
    h.getBranding.mockResolvedValue(noName);
    await deliver({ request: request({ language }) });
    const [, req] = h.sendSms.mock.calls[0] as [SupabaseClient, SmsRequest];
    expect(req.body).toBe(`${lead} ${url()}`);
  });

  it.each([
    ["es", "Le pedimos unos documentos"],
    ["en", "We need a few documents from you"],
  ] as const)("the email in %s: the no-name subject, and the From name is the brand display name every other customer email sends (blank), never 'the business'/'el negocio' (mutation: fall back to customerDocs.business -> FAILS)", async (language, subject) => {
    h.getBranding.mockResolvedValue(noName);
    await deliver({ channel: "email", request: request({ channel: "email", language }) });
    const [req] = h.sendEmail.mock.calls[0] as [EmailRequest];
    expect(req.subject).toBe(subject);
    expect(req.fromName).toBe("");
    expect(`${req.subject} ${req.body} ${req.html}`).not.toMatch(/the business|el negocio/i);
  });
});

describe("deliverDocumentRequest by email", () => {
  const until = new Date("2026-10-16T13:00:00.000Z");
  const deliverEmail = (over: Partial<DocumentRequestRow> = {}) => deliver({ channel: "email", request: request({ channel: "email", ...over }) });

  it("6. hands the email gate the informational kind, the target's address, the request's language, the origin, the template's subject and parts, the business as the From name, the account's sending address and reply-to", async () => {
    await deliverEmail();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const [req, deps] = h.sendEmail.mock.calls[0] as [EmailRequest, { db: SupabaseClient }];
    const mail = documentRequestEmail({ brand: emailBrand(branding), business: "Casa Verde", items: "Seguro, Pool permit", url: url(), locale: "es" });
    expect(deps).toEqual({ db });
    expect(req).toEqual({
      accountId: ACCT, kind: "staff.document_request_email", contactId: "contact-1", to: "ana@example.com",
      fromName: "Casa Verde", fromAddress: "hola@casaverde.example", replyTo: "office@casaverde.example",
      subject: mail.subject, body: mail.text, html: mail.html, language: "es", origin: ORIGIN, now: NOW, accountZone: ZONE,
    });
    expect(EMAIL_KINDS[req.kind]).toEqual({ class: "informational", hours: "automated", footer: "unsubscribe" });
    expect(mail.subject).toBe("Casa Verde necesita unos documentos");
  });

  it("6. no sending address or reply-to set: both are omitted, never sent blank", async () => {
    h.getSendingIdentity.mockResolvedValue({ fromEmail: null });
    h.getBranding.mockResolvedValue({ ...branding, replyToEmail: "  " });
    await deliverEmail();
    const [req] = h.sendEmail.mock.calls[0] as [EmailRequest];
    expect(req.fromAddress).toBeUndefined();
    expect(req.replyTo).toBeUndefined();
  });

  it("6. sent: the conversation row (channel email, the staff member as author) and What went out are written AFTER the send (mutation: write the row first -> FAILS)", async () => {
    const out = await deliverEmail();
    expect(out).toEqual({ kind: "sent" });
    expect(h.calls).toEqual(["claim", "gate:email", "provider:email", "ensureConversation", "createMessage:email", "status:sent", "log:sent"]);
    const mail = documentRequestEmail({ brand: emailBrand(branding), business: "Casa Verde", items: "Seguro, Pool permit", url: url(), locale: "es" });
    expect(h.createMessage).toHaveBeenCalledWith(db, ACCT, {
      conversationId: "convo-1", channel: "email", direction: "outbound", subject: mail.subject, body: mail.text,
    }, ACTOR);
    // The provider id the Resend webhook correlates delivery and bounces against (updateMessageStatusByProviderId).
    expect(h.updateMessageStatus).toHaveBeenCalledWith(db, ACCT, "msg-1", "sent", { providerMessageId: "re-msg-1" }, ACTOR);
    expect(logged()).toEqual([expect.objectContaining({ channel: "email", status: "sent", subjectKey: `document_request:${REQ_ID}`, payload: { channel: "email", actorId: ACTOR } })]);
  });

  it("6. deferred: held with the gate's until and zone; no conversation row; the stamp cleared", async () => {
    h.emailAnswer.value = { kind: "deferred", until, zone: ZONE };
    const out = await deliverEmail();
    expect(out).toEqual({ kind: "held", until: until.toISOString(), zone: ZONE });
    expect(h.writeHeld).toHaveBeenCalledWith({ db }, expect.objectContaining({ channel: "email", payload: { channel: "email", actorId: ACTOR } }), until, ZONE);
    expect(h.createMessage).not.toHaveBeenCalled();
    expect(h.store.sentAt).toBeNull();
    expect(h.calls.indexOf("clear")).toBeLessThan(h.calls.indexOf("writeHeld"));
  });

  it.each([
    ["stopped", EMAIL_BLOCK_REASONS.stopped, "documents.request.reason.emailStopped"],
    ["held", EMAIL_BLOCK_REASONS.held, "documents.request.reason.emailHeld"],
    ["suppressed", EMAIL_BLOCK_REASONS.suppressed, "documents.request.reason.bounced"],
    ["no_address", EMAIL_BLOCK_REASONS.no_address, "documents.request.reason.noEmail"],
    ["suppressed_account", EMAIL_BLOCK_REASONS.suppressed_account, "documents.request.reason.failed"],
  ] as const)("6. blocked %s: skipped with the Activity page's words, the dialog's reason, the stamp cleared (mutation: swap any one mapping -> FAILS)", async (reason, logReason, key) => {
    h.emailAnswer.value = { kind: "blocked", reason };
    const out = await deliverEmail();
    expect(out).toEqual({ kind: "blocked", reason: key });
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: logReason, channel: "email" })]);
    expect(h.store.sentAt).toBeNull();
    expect(h.createMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["ledger_unavailable", REASONS.emailLedgerRetry],
    ["unsubscribe_unavailable", REASONS.emailSetupRetry],
  ] as const)("6. blocked %s is an outage: held 15 minutes with the email's own retry line (mutation: skip it -> FAILS)", async (reason, line) => {
    h.emailAnswer.value = { kind: "blocked", reason };
    const out = await deliverEmail();
    const later = new Date(NOW.getTime() + 15 * 60_000);
    expect(out).toEqual({ kind: "held", until: later.toISOString(), zone: "UTC" });
    expect(h.writeHeld).toHaveBeenCalledWith({ db }, expect.objectContaining({ channel: "email" }), later, "UTC", line);
    expect(h.store.sentAt).toBeNull();
  });

  it("6. a target with no address: no gate call, skipped with the no-email line", async () => {
    h.documentRequestTarget.mockResolvedValue(target({ email: "   " }));
    const out = await deliverEmail();
    expect(out).toEqual({ kind: "blocked", reason: "documents.request.reason.noEmail" });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.claimDocumentRequestSend).not.toHaveBeenCalled();
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: REASONS.noEmail })]);
  });

  it("6. failed at the provider: What went out says failed and the stamp is cleared", async () => {
    h.emailAnswer.value = { kind: "failed", stage: "provider", error: "500" };
    expect(await deliverEmail()).toEqual({ kind: "failed" });
    expect(logged()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
    expect(h.store.sentAt).toBeNull();
  });

  it("10. a sent email whose conversation row AND log write both reject is still sent (plan review I4; mutation: let either reach the outer catch -> FAILS)", async () => {
    h.ensureConversation.mockRejectedValue(new Error("convo down"));
    h.recordAutomationLog.mockRejectedValue(new Error("log down"));
    expect(await deliverEmail()).toEqual({ kind: "sent" });
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes(REQ_ID) && l.includes("conversation row was not written"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes(REQ_ID) && l.includes("What went out not written (sent)"))).toHaveLength(1);
  });

  it("11. an email whose gate REJECTS clears the stamp before the error reaches the outer catch (mutation: no clear on the thrown path -> FAILS)", async () => {
    h.sendEmail.mockRejectedValue(new Error("gate threw"));
    expect(await deliverEmail()).toEqual({ kind: "failed" });
    expect(h.store.sentAt).toBeNull();
    expect(h.calls.indexOf("clear")).toBeGreaterThan(-1);
    expect(h.calls.indexOf("clear")).toBeLessThan(h.calls.indexOf("log:failed"));
  });

  it.each([
    ["deferred", { kind: "deferred", until, zone: ZONE }],
    ["blocked ledger_unavailable", { kind: "blocked", reason: "ledger_unavailable" }],
    ["blocked unsubscribe_unavailable", { kind: "blocked", reason: "unsubscribe_unavailable" }],
  ] as const)("11. %s while the stamp CANNOT be cleared: nothing is held (the releaser would mark it sent unsent), the row is failed, the answer failed (mutation: hold anyway -> FAILS)", async (_label, answer) => {
    h.emailAnswer.value = answer;
    h.clearDocumentRequestSend.mockRejectedValue(new Error("clear down"));
    expect(await deliverEmail()).toEqual({ kind: "failed" });
    expect(h.writeHeld).not.toHaveBeenCalled();
    expect(logged()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
  });

  it.each([
    ["stopped", EMAIL_BLOCK_REASONS.stopped, "documents.request.reason.emailStopped"],
    ["suppressed", EMAIL_BLOCK_REASONS.suppressed, "documents.request.reason.bounced"],
    ["no_address", EMAIL_BLOCK_REASONS.no_address, "documents.request.reason.noEmail"],
  ] as const)("M2. blocked %s while the stamp cannot be cleared still reports the real refusal, never failed (nothing would be held anyway; mutation: take the fail-instead-of-hold branch for every non-sent answer -> FAILS)", async (reason, logReason, key) => {
    h.emailAnswer.value = { kind: "blocked", reason };
    h.clearDocumentRequestSend.mockRejectedValue(new Error("clear down"));
    expect(await deliverEmail()).toEqual({ kind: "blocked", reason: key });
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: logReason })]);
    expect(h.writeHeld).not.toHaveBeenCalled();
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes(REQ_ID) && l.includes("send stamp could not be cleared"))).toHaveLength(1);
  });

  it("11. a lost claim (another release already sent it) sends nothing and answers sent", async () => {
    h.store.sentAt = "2026-10-15T14:59:00.000Z";
    expect(await deliverEmail()).toEqual({ kind: "sent" });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.store.sentAt).toBe("2026-10-15T14:59:00.000Z");
  });
});

describe("at most once (re-review R1)", () => {
  it("11. a lost claim in prepare sends nothing, writes no row, does NOT clear the other sender's stamp, and answers sent (mutation: clear on a lost claim -> FAILS)", async () => {
    h.store.sentAt = "2026-10-15T14:59:00.000Z";
    expect(await deliver()).toEqual({ kind: "sent" });
    expect(h.calls).not.toContain("provider:sms");
    expect(h.createMessage).not.toHaveBeenCalled();
    expect(h.store.sentAt).toBe("2026-10-15T14:59:00.000Z");
  });

  it("11. a text whose message row cannot be written in prepare: nothing leaves and the stamp is cleared (mutation: no clear -> FAILS)", async () => {
    h.createMessage.mockRejectedValue(new Error("row down"));
    expect(await deliver()).toEqual({ kind: "failed" });
    expect(h.calls).not.toContain("provider:sms");
    expect(h.store.sentAt).toBeNull();
  });

  it("11. deferred and blocked texts leave the stamp unset (the gate answers them before prepare claims it)", async () => {
    h.smsAnswer.value = { kind: "deferred", until: new Date("2026-10-16T13:00:00.000Z"), zone: ZONE };
    await deliver();
    expect(h.store.sentAt).toBeNull();
    h.smsAnswer.value = { kind: "blocked", reason: "stopped" };
    await deliver();
    expect(h.store.sentAt).toBeNull();
    expect(h.claimDocumentRequestSend).not.toHaveBeenCalled();
  });
});

const heldRow = (over: Partial<AutomationLogRow> = {}): AutomationLogRow => ({
  id: "log-1", account_id: ACCT, source: "document_request", channel: "sms", contact_id: "contact-1",
  subject_key: `document_request:${REQ_ID}`, status: "held", reason: "Held until 8:00 AM — quiet hours",
  held_until: "2026-10-16T13:00:00.000Z", payload: { channel: "text", actorId: ACTOR }, occurred_at: "2026-10-15T03:00:00.000Z",
  ...over,
});
const ctx = { db, now: NOW, origin: ORIGIN } as unknown as PassContext;

describe("releaseDocumentRequest", () => {
  it.each([
    ["revoked", { revoked_at: "2026-10-15T10:00:00.000Z", revoked_by: ACTOR }],
    ["completed", { completed_at: "2026-10-15T10:00:00.000Z" }],
    ["expired", { expires_at: "2026-10-15T14:59:59.000Z" }],
  ])("8. a held row whose request is %s is No longer due, and nothing is sent (mutation: send a revoked request's link -> FAILS)", async (_label, over) => {
    h.getDocumentRequest.mockResolvedValue(request(over));
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("skipped");
    expect(h.logSkipped).toHaveBeenCalledWith(ctx, expect.objectContaining({ subjectKey: `document_request:${REQ_ID}`, source: "document_request" }), REASONS.noLongerDue);
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("8. a request that is gone is No longer due", async () => {
    h.getDocumentRequest.mockResolvedValue(null);
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("skipped");
    expect(h.logSkipped).toHaveBeenCalledWith(ctx, expect.anything(), REASONS.noLongerDue);
  });

  it("8. an open one is delivered by the payload's channel and actor, at ctx.origin, read in its own account", async () => {
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("sent");
    expect(h.getDocumentRequest).toHaveBeenCalledWith(db, ACCT, REQ_ID);
    const [, req] = h.sendSms.mock.calls[0] as [SupabaseClient, SmsRequest];
    expect(req.kind).toBe("staff.document_request_sms");
    expect(req.body.endsWith(url())).toBe(true);
    expect(h.createMessage).toHaveBeenCalledWith(db, ACCT, expect.objectContaining({ channel: "sms" }), ACTOR);
  });

  it("8. the email channel releases by email", async () => {
    expect(await releaseDocumentRequest(ctx, heldRow({ channel: "email", payload: { channel: "email", actorId: ACTOR } }))).toBe("sent");
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it.each([
    ["held", { kind: "deferred", until: new Date("2026-10-16T13:00:00.000Z"), zone: ZONE }],
    ["skipped", { kind: "blocked", reason: "stopped" }],
    ["failed", { kind: "failed", stage: "provider", error: "500", carrierBlocked: false }],
  ] as const)("8. the delivery's answer maps to the release verdict: %s (mutation: map blocked to failed -> FAILS)", async (verdict, answer) => {
    h.smsAnswer.value = answer;
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe(verdict);
  });

  it.each([
    ["a malformed subject key", heldRow({ subject_key: "document_request:not-a-uuid" })],
    ["no channel in the payload", heldRow({ payload: { actorId: ACTOR } })],
    ["no actor in the payload", heldRow({ payload: { channel: "text" } })],
  ])("8. %s is skipped, never sent", async (_label, row) => {
    expect(await releaseDocumentRequest(ctx, row)).toBe("skipped");
    expect(h.getDocumentRequest).not.toHaveBeenCalled();
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it("11. at most once: a release whose What-went-out write is lost answers sent; the NEXT release of the same row sends NOTHING and writes the row (mutation: drop the sent_at check -> the second release's claim is lost, so it sends nothing but never writes the row either, and the held row never leaves the queue -> FAILS)", async () => {
    h.recordAutomationLog.mockRejectedValue(new Error("log down"));
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("sent");
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    h.recordAutomationLog.mockReset();
    h.recordAutomationLog.mockImplementation(async (_db: unknown, w: { status: string }) => { h.calls.push(`log:${w.status}`); });
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("sent");
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    expect(logged()).toEqual([expect.objectContaining({ status: "sent", subjectKey: `document_request:${REQ_ID}` })]);
  });

  /**
   * Orchestrator ruling I1 (textback.ts's 2026-09-27 rule): on a RELEASE, a failure before anything went out
   * and while no stamp is held leaves the held row for the next tick. The releaser THROWS, so release-held
   * counts it errored and writes nothing (release-held.ts's per-row catch); the row keeps its past
   * held_until and is examined again next tick, until the 7-day expiry makes it "No longer due".
   */
  const releaseRejectsUnwritten = async (row = heldRow()) => {
    const err = await releaseDocumentRequest(ctx, row).then(() => null, (e: unknown) => e as Error);
    expect(err, "the releaser must throw so release-held leaves the row").toBeInstanceOf(Error);
    expect(err!.message).toContain(REQ_ID);
    // Under the test's secret, whatever the case did to the env (the link-key case empties it).
    const prev = process.env.DOCUMENT_LINK_SECRET ?? "";
    vi.stubEnv("DOCUMENT_LINK_SECRET", SECRET);
    const token = requestToken(REQ_ID);
    vi.stubEnv("DOCUMENT_LINK_SECRET", prev);
    expect(err!.message).not.toContain(token);
    expect(logged(), "no row written: the held row stays in the queue").toEqual([]);
    expect(h.logSkipped).not.toHaveBeenCalled();
    expect(h.store.sentAt).toBeNull();
  };

  it("I1. a release whose branding read rejects ONCE leaves the row unwritten, and the next release sends (mutation: write it failed as the direct path does -> FAILS)", async () => {
    h.getBranding.mockRejectedValueOnce(new Error("branding down"));
    await releaseRejectsUnwritten();
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("sent");
    expect(h.calls.filter((c) => c === "provider:sms")).toHaveLength(1);
    expect(logged()).toEqual([expect.objectContaining({ status: "sent" })]);
  });

  it.each([
    ["the target read", () => h.documentRequestTarget.mockRejectedValueOnce(new Error("target down")), heldRow()],
    ["the zone read", () => h.readAccountTimezone.mockRejectedValueOnce(new Error("zone down")), heldRow()],
    ["the link key", () => vi.stubEnv("DOCUMENT_LINK_SECRET", ""), heldRow()],
    ["the sender read inside the gate (a gate throw)", () => h.sendSms.mockRejectedValueOnce(new Error("resolveSmsSender failed")), heldRow()],
    ["the sending-identity read (email)", () => h.getSendingIdentity.mockRejectedValueOnce(new Error("identity down")), heldRow({ channel: "email", payload: { channel: "email", actorId: ACTOR } })],
  ])("I1. on release, a failure in %s leaves the row unwritten (mutation: write it failed -> FAILS)", async (_label, arrange, row) => {
    arrange();
    await releaseRejectsUnwritten(row);
  });

  it.each([
    ["a text", heldRow()],
    ["an email", heldRow({ channel: "email", payload: { channel: "email", actorId: ACTOR } })],
  ])("I1. on release, %s whose re-hold writeHeld rejects leaves the row for the next tick (mutation: write it failed -> FAILS)", async (_label, row) => {
    h.smsAnswer.value = { kind: "deferred", until: new Date("2026-10-16T13:00:00.000Z"), zone: ZONE };
    h.emailAnswer.value = { kind: "deferred", until: new Date("2026-10-16T13:00:00.000Z"), zone: ZONE };
    h.writeHeld.mockRejectedValueOnce(new Error("hold down"));
    await releaseRejectsUnwritten(row);
  });

  it("I1. on release, an email gate throw whose stamp clear SUCCEEDED leaves the row (nothing went out, no stamp)", async () => {
    h.sendEmail.mockRejectedValueOnce(new Error("gate threw"));
    await releaseRejectsUnwritten(heldRow({ channel: "email", payload: { channel: "email", actorId: ACTOR } }));
  });

  it("I1. on release, an email gate throw whose stamp clear FAILED is failed: a stamp is still held, so a retry would be written sent unsent (mutation: retry it -> FAILS)", async () => {
    h.sendEmail.mockRejectedValueOnce(new Error("gate threw"));
    h.clearDocumentRequestSend.mockRejectedValue(new Error("clear down"));
    expect(await releaseDocumentRequest(ctx, heldRow({ channel: "email", payload: { channel: "email", actorId: ACTOR } }))).toBe("failed");
    expect(logged()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
  });

  it("I1. on release, an email claim that THROWS is failed: whether the stamp was written is unknown", async () => {
    h.claimDocumentRequestSend.mockRejectedValueOnce(new Error("claim down"));
    expect(await releaseDocumentRequest(ctx, heldRow({ channel: "email", payload: { channel: "email", actorId: ACTOR } }))).toBe("failed");
    expect(logged()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
  });

  it("I1. on release, a post-claim provider failure is still failed and leaves the queue: an unclear provider failure is never retried (mutation: leave it for the next tick -> FAILS)", async () => {
    h.smsAnswer.value = { kind: "failed", stage: "provider", error: "timeout", carrierBlocked: false };
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("failed");
    expect(logged()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
    h.emailAnswer.value = { kind: "failed", stage: "provider", error: "timeout" };
    expect(await releaseDocumentRequest(ctx, heldRow({ channel: "email", payload: { channel: "email", actorId: ACTOR } }))).toBe("failed");
    expect(logged()).toHaveLength(2);
  });

  it("11. while the write keeps failing, the next release throws to release-held's catch (errored) and STILL sends nothing", async () => {
    h.recordAutomationLog.mockRejectedValue(new Error("log down"));
    expect(await releaseDocumentRequest(ctx, heldRow())).toBe("sent");
    await expect(releaseDocumentRequest(ctx, heldRow())).rejects.toThrow("log down");
    expect(h.sendSms).toHaveBeenCalledTimes(1);
  });
});

describe("requestChannels (P6)", () => {
  it("offers text when the account can text, the number can be texted and it has not stopped; email when there is an address", async () => {
    expect(await requestChannels(db, ledger, ACCT, target())).toEqual({ text: true, email: true });
    expect(h.resolveSmsSender).toHaveBeenCalledWith(db, ACCT);
    expect(h.smsRecipientState).toHaveBeenCalledWith(ledger, ACCT, { phone: "(956) 555-0123", phone_country_unconfirmed: false });
  });

  it("9. no text when the account cannot text (mutation: drop the sender check -> FAILS)", async () => {
    h.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    expect(await requestChannels(db, ledger, ACCT, target())).toEqual({ text: false, email: true });
  });

  it("9. a sender read error counts as no", async () => {
    h.resolveSmsSender.mockRejectedValue(new Error("down"));
    expect(await requestChannels(db, ledger, ACCT, target())).toEqual({ text: false, email: true });
  });

  it("9. no text for a number that cannot be texted (mutation: drop the normalisePhone check -> FAILS)", async () => {
    expect(await requestChannels(db, ledger, ACCT, target({ phone: "12" }))).toEqual({ text: false, email: true });
  });

  it.each([
    ["stopped", { kind: "stopped", since: "2026-10-01T00:00:00.000Z" }],
    ["held", { kind: "held", since: "2026-10-01T00:00:00.000Z" }],
    ["unconfirmed_number", { kind: "unconfirmed_number" }],
    ["unknown", { kind: "unknown" }],
  ])("9. no text when the number's state is %s (mutation: ignore smsRecipientState -> FAILS)", async (_label, state) => {
    h.smsRecipientState.mockResolvedValue(state);
    expect(await requestChannels(db, ledger, ACCT, target())).toEqual({ text: false, email: true });
  });

  it("9. no email without an address; a null target offers neither", async () => {
    expect(await requestChannels(db, ledger, ACCT, target({ email: " " }))).toEqual({ text: true, email: false });
    expect(await requestChannels(db, ledger, ACCT, target({ email: null }))).toEqual({ text: true, email: false });
    expect(await requestChannels(db, ledger, ACCT, null)).toEqual({ text: false, email: false });
  });
});
