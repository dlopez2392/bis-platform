import { describe, it, expect, vi, beforeEach } from "vitest";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ACCOUNT = "acc_1";
const USER = "user_1";
const CONV = "conv";
const CTX = { writer: { tag: "writer" }, address: "ana@example.com" } as unknown as { writer: unknown; address: string };

const requireAccountAccessMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (...a: unknown[]) => requireAccountAccessMock(...a),
}));

/**
 * The request client's own answer to `provedThread`'s
 * `from("conversations").select("id, contact_id").eq(...).eq(...).maybeSingle()` chain, built the way
 * conversations/actions.test.ts builds its `dbForRequest` fake — but, per the review fix, the fake
 * itself CHECKS the two `.eq` filters rather than ignoring them: a mutation that drops either filter
 * from `provedThread` makes the filters object it submits incomplete, and the fake then answers "not
 * found" exactly as real RLS would for a row this account/id pair doesn't name.
 */
const CONV_ROW = vi.hoisted(() => ({ value: null as { id: string; contact_id: string } | null }));
/** Fix round 1 (minor): a one-off way to make the conversations table read answer an outage rather
 *  than a miss, for provedRow's own error-checking test — reset to null in afterEach. */
const CONV_READ_ERROR = vi.hoisted(() => ({ value: null as string | null }));
const REQUEST_DB = vi.hoisted(() => ({ tag: "request-db" }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    ...REQUEST_DB,
    from: (table: string) => {
      if (table !== "conversations") throw new Error(`unexpected table ${table}`);
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
        maybeSingle: async () => {
          if (CONV_READ_ERROR.value) return { data: null, error: { message: CONV_READ_ERROR.value } };
          const matches = filters.account_id === ACCOUNT && filters.id === CONV;
          return { data: matches ? CONV_ROW.value : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

const SERVICE = vi.hoisted(() => ({ tag: "service-db" }));
const dbMock = vi.hoisted(() => ({
  readConsentHistory: vi.fn(),
  newestDecidingRow: vi.fn(),
  listMessages: vi.fn(),
  getInboundEmail: vi.fn(),
  decideInboundEmail: vi.fn(),
  unfileInboundEmail: vi.fn(),
  matchSender: vi.fn(),
  ensureConversation: vi.fn(),
  getContact: vi.fn(),
  serviceDb: vi.fn(() => SERVICE),
  deleteInboundMessageByProviderId: vi.fn(),
  // Contact archive T9 (review I6): a GUARD only. A teammate's manual File is staff's act, never the customer's.
  restoreContactOnSign: vi.fn(),
}));
vi.mock("@bis/db", () => dbMock);

const fileMock = vi.hoisted(() => ({ fileInboundEmail: vi.fn() }));
vi.mock("@/lib/email/inbound/file", () => fileMock);

/**
 * Task 12's held-row fixture and the `requestRow` helper the brief names: `getInboundEmail` is
 * mocked to answer `requestRow()` only when called with the REQUEST client (the object
 * `dbForRequest`'s fake hands back, tagged "request-db" since that fake is rebuilt — spread — on
 * every call, so no two calls are ever `===`), and to fail the test with a thrown "service read"
 * for any other first argument, so a service-client read of the held row is caught by name.
 */
const requestRow = vi.hoisted(() => vi.fn());
const HELD = vi.hoisted(() => ({
  id: "ie_1", accountId: "acc_1", conversationId: "conv", providerEmailId: "prov_1",
  fromEmail: "luis@example.com", fromName: "Luis", toEmail: "r-abc@reply.bis-rgv.com",
  subject: "Re: appointment", text: "Thursday works for me.",
  auth: { spf: "pass", dkim: "pass", dmarc: "pass", spam: "no", virus: "no" },
  attachmentCount: 2, status: "held", holdReason: "not_on_record" as const, messageId: null as string | null,
  decidedBy: null as string | null, decidedAt: null as string | null, receivedAt: "2026-10-16T15:00:00.000Z",
}));
const HELD_CONTACT = "ana";

/** Item 3's own `requestRow`-style wrapper for `getContact`: resolves `getContactResult()` only on
 *  the request client, and rejects by name ("service read") for any other first argument — so a
 *  mutation that reads the chosen contact on the service client is caught the same way
 *  `getInboundEmail`'s own binding is. */
const getContactResult = vi.hoisted(() => vi.fn());

const ctxMock = vi.hoisted(() => ({ emailContextFor: vi.fn() }));
vi.mock("@/lib/consent/email-context", () => ctxMock);

const staffMock = vi.hoisted(() => ({ undoInboundStop: vi.fn(), stopEmails: vi.fn() }));
vi.mock("@/lib/consent/email-staff-actions", () => staffMock);

import { undoReplyStopAction, stopEmailsFromReplyAction, fileHeldEmailAction, dismissHeldEmailAction, undoHeldEmailAction } from "./inbound-actions";

const message = (over: Partial<{ id: string; channel: string; direction: string; meta: unknown }> = {}) => ({
  id: "msg_other", channel: "email", direction: "inbound", meta: {}, ...over,
});

beforeEach(() => {
  requireAccountAccessMock.mockReset().mockResolvedValue({ userId: USER });
  CONV_ROW.value = { id: CONV, contact_id: "ana" };
  CONV_READ_ERROR.value = null;
  dbMock.readConsentHistory.mockReset();
  dbMock.newestDecidingRow.mockReset();
  dbMock.listMessages.mockReset().mockResolvedValue([]);
  ctxMock.emailContextFor.mockReset();
  staffMock.undoInboundStop.mockReset();
  staffMock.stopEmails.mockReset();

  requestRow.mockReset();
  dbMock.getInboundEmail.mockReset().mockImplementation((c: { tag?: string }) =>
    c?.tag === "request-db" ? requestRow() : Promise.reject(new Error("service read")));
  dbMock.decideInboundEmail.mockReset();
  dbMock.unfileInboundEmail.mockReset();
  dbMock.matchSender.mockReset().mockResolvedValue(null);
  dbMock.ensureConversation.mockReset();
  getContactResult.mockReset();
  dbMock.getContact.mockReset().mockImplementation((c: { tag?: string }) =>
    c?.tag === "request-db" ? getContactResult() : Promise.reject(new Error("service read")));
  dbMock.deleteInboundMessageByProviderId.mockReset().mockResolvedValue(false);
  dbMock.restoreContactOnSign.mockReset();
  fileMock.fileInboundEmail.mockReset();
});

describe("undoReplyStopAction", () => {
  it("binds the eventId to the message that actually carries it on THIS thread, and undoes for that message's sender (a household member), not the thread's own contact (mutation: use the thread's contact → wrong address, FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { sender: { contact_id: "luis" }, consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });

    expect(await undoReplyStopAction(ACCOUNT, "en", CONV, "ev_1")).toEqual({ ok: true });
    expect(dbMock.listMessages).toHaveBeenCalledWith(expect.objectContaining({ tag: "request-db" }), ACCOUNT, CONV);
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER, "en");
    expect(staffMock.undoInboundStop).toHaveBeenCalledWith(CTX, "ev_1");
  });

  it("a conversation the caller cannot see is refused before any thread read (mutation: skip the proof → FAILS)", async () => {
    CONV_ROW.value = null;

    const result = await undoReplyStopAction(ACCOUNT, "en", CONV, "ev_1");
    expect(result.ok).toBe(false);
    expect(dbMock.listMessages).not.toHaveBeenCalled();
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(staffMock.undoInboundStop).not.toHaveBeenCalled();
  });

  // S-10 T9a: the inbox bubble's own reader locale, not the explicit "en" this action used before
  // Conversations resolved one of its own — both the action's own fallback string AND the context it
  // hands downstream (so undoInboundStop's replyExpiredExplain reaches a Spanish reader too).
  it("in Spanish: the own-fallback 'changed' error is Spanish, and emailContextFor is called with 'es', never a hard-coded 'en' (mutation: pass \"en\" to emailContextFor regardless of locale → FAILS)", async () => {
    CONV_ROW.value = null;

    const result = await undoReplyStopAction(ACCOUNT, "es", CONV, "ev_1");
    expect(result).toEqual({ ok: false, error: t(m, "conversations.held.changed", "es") });
  });

  it("in Spanish: a bound stop's context is built with the reader's own locale, not English (mutation: pass \"en\" to emailContextFor regardless of locale → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { sender: { contact_id: "luis" }, consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });

    await undoReplyStopAction(ACCOUNT, "es", CONV, "ev_1");
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER, "es");
  });

  it("an eventId not carried by any message on this thread is refused, never reaching emailContextFor (mutation: skip the binding check → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { consent: { kind: "stopped", eventId: "ev_OTHER" } } }),
    ]);

    const result = await undoReplyStopAction(ACCOUNT, "en", CONV, "ev_1");
    expect(result.ok).toBe(false);
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(staffMock.undoInboundStop).not.toHaveBeenCalled();
  });

  it("when no message carries a sender, undoes for the thread's own contact (mutation: require a sender always → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });

    expect(await undoReplyStopAction(ACCOUNT, "en", CONV, "ev_1")).toEqual({ ok: true });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "ana", USER, "en");
  });

  it("passes undoInboundStop's typed expired flag through, never by matching the error string (mutation: drop the pass-through → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: false, error: "Only the customer can turn these emails back on.", expired: true });

    expect(await undoReplyStopAction(ACCOUNT, "en", CONV, "ev_1")).toEqual({
      ok: false, error: "Only the customer can turn these emails back on.", expired: true,
    });
  });

  it("a stale-click 'changed' refusal carries no expired flag at all (mutation: always set expired → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: false, error: "Their emails changed while you were looking. This is where they stand now." });

    const result = await undoReplyStopAction(ACCOUNT, "en", CONV, "ev_1");
    expect(result).toEqual({ ok: false, error: "Their emails changed while you were looking. This is where they stand now." });
    expect(result).not.toHaveProperty("expired");
  });
});

describe("stopEmailsFromReplyAction", () => {
  it("stops the thread's own contact's emails over the newest row it reads now (a fresh click; mutation: pass null as expectNewest always → refused over an allowed history, FAILS)", async () => {
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    dbMock.readConsentHistory.mockResolvedValue([{ id: "ev_0", action: "resubscribed", method: "staff", occurred_at: "x" }]);
    dbMock.newestDecidingRow.mockReturnValue({ id: "ev_0", action: "resubscribed" });
    staffMock.stopEmails.mockResolvedValue({ ok: true, view: {} });

    expect(await stopEmailsFromReplyAction(ACCOUNT, "en", CONV, "ana")).toEqual({ ok: true });
    expect(dbMock.readConsentHistory).toHaveBeenCalledWith(CTX.writer, ACCOUNT, "email", CTX.address);
    expect(staffMock.stopEmails).toHaveBeenCalledWith(CTX, "ev_0");
  });

  it("stops a household member's emails when their contactId is bound to a message on this thread (mutation: skip the binding check → FAILS the next case)", async () => {
    dbMock.listMessages.mockResolvedValue([message({ meta: { sender: { contact_id: "luis" } } })]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    dbMock.readConsentHistory.mockResolvedValue([]);
    dbMock.newestDecidingRow.mockReturnValue(null);
    staffMock.stopEmails.mockResolvedValue({ ok: true, view: {} });

    expect(await stopEmailsFromReplyAction(ACCOUNT, "en", CONV, "luis")).toEqual({ ok: true });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER, "en");
  });

  it("a contactId that is neither the thread's own contact nor any sender on this thread is refused before any service read (mutation: drop the binding check → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([message({ meta: { sender: { contact_id: "luis" } } })]);

    const result = await stopEmailsFromReplyAction(ACCOUNT, "en", CONV, "someone-else");
    expect(result.ok).toBe(false);
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(dbMock.readConsentHistory).not.toHaveBeenCalled();
    expect(staffMock.stopEmails).not.toHaveBeenCalled();
  });

  it("a conversation the caller cannot see is refused before any service read (mutation: skip the proof → FAILS)", async () => {
    CONV_ROW.value = null;

    const result = await stopEmailsFromReplyAction(ACCOUNT, "en", CONV, "ana");
    expect(result.ok).toBe(false);
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(dbMock.readConsentHistory).not.toHaveBeenCalled();
    expect(staffMock.stopEmails).not.toHaveBeenCalled();
  });

  // S-10 T9a: same fix as undoReplyStopAction.
  it("in Spanish: the own-fallback 'changed' error is Spanish, and emailContextFor is called with 'es' (mutation: pass \"en\" to emailContextFor regardless of locale → FAILS)", async () => {
    CONV_ROW.value = null;

    const result = await stopEmailsFromReplyAction(ACCOUNT, "es", CONV, "ana");
    expect(result).toEqual({ ok: false, error: t(m, "conversations.held.changed", "es") });
  });

  it("in Spanish: a bound member's context is built with the reader's own locale (mutation: pass \"en\" to emailContextFor regardless of locale → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([message({ meta: { sender: { contact_id: "luis" } } })]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    dbMock.readConsentHistory.mockResolvedValue([]);
    dbMock.newestDecidingRow.mockReturnValue(null);
    staffMock.stopEmails.mockResolvedValue({ ok: true, view: {} });

    await stopEmailsFromReplyAction(ACCOUNT, "es", CONV, "luis");
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER, "es");
  });
});

describe("fileHeldEmailAction (spec 'Needs a look')", () => {
  it("proves the held row on the request client, files it on the suggestion with no unread and no forward, as the person (mutation: raiseUnread true → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: true, undo: { kind: "unfile", id: "ie_1", messageId: "msg_1" } });
    expect(dbMock.decideInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "held", { status: "filed", decidedBy: USER });
    expect(fileMock.fileInboundEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ raiseUnread: false, actor: { id: USER, type: "user" }, contactId: HELD_CONTACT, attachmentCount: 2 }));
  });

  it("a teammate's File never restores an archived contact, on the suggestion or on Choose a record: the timeline would name staff's act as the customer's (contact archive T9, review I6; mutation: call restoreContactOnSign from fileHeldEmailAction → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toMatchObject({ ok: true });
    getContactResult.mockResolvedValue({ id: "pat" });
    dbMock.ensureConversation.mockResolvedValue({ id: "conv_pat", created: false });
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", "pat")).toMatchObject({ ok: true });
    expect(fileMock.fileInboundEmail).toHaveBeenCalledTimes(2);
    expect(dbMock.restoreContactOnSign).not.toHaveBeenCalled();
  });

  it("a File that recorded a stop carries the stop's eventId on its Undo (fix round 1 item 1; mutation: drop eventId from the undo payload → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "stopped", eventId: "ev_1" } });
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: true, undo: { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" } });
  });

  it("Choose a record: proves the chosen contact on the REQUEST client, never the service client, and files on that contact's thread, moving conversation_id in the SAME compare-and-set (fix round 1 items 3, 4; mutation: getContact(serviceDb(), …) → the request-client assertion FAILS; mutation: file on the suggestion → FAILS; mutation: omit conversationId from decideInboundEmail's write → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    getContactResult.mockResolvedValue({ id: "pat", first_name: "Pat" });
    dbMock.ensureConversation.mockResolvedValue({ id: "conv_pat", created: false });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_2", created: true, consent: { kind: "none" } });
    await fileHeldEmailAction(ACCOUNT, "ie_1", "pat");
    expect(dbMock.getContact).toHaveBeenCalledWith(expect.objectContaining({ tag: "request-db" }), ACCOUNT, "pat");
    expect(dbMock.ensureConversation).toHaveBeenCalledWith(SERVICE, ACCOUNT, "pat", USER);
    expect(dbMock.decideInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "held", { status: "filed", decidedBy: USER, conversationId: "conv_pat" });
    expect(fileMock.fileInboundEmail.mock.calls[0]![1]).toMatchObject({ contactId: "pat", row: expect.objectContaining({ conversationId: "conv_pat" }) });
    getContactResult.mockResolvedValue(null);
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", "ghost")).toEqual({ ok: false, error: "changed" });
  });

  it("filing on the suggestion (no Choose a record) never carries a conversationId in the compare-and-set — the row's own thread is unchanged (mutation: always pass conversationId → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
    await fileHeldEmailAction(ACCOUNT, "ie_1", null);
    expect(dbMock.decideInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "held", { status: "filed", decidedBy: USER });
    expect(dbMock.ensureConversation).not.toHaveBeenCalled();
  });

  it("a row someone already moved answers 'changed' and files nothing (mutation: skip the compare-and-set → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(false);
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: false, error: "changed" });
    expect(fileMock.fileInboundEmail).not.toHaveBeenCalled();
  });

  it("a filing failure deletes the orphaned message for this row's own provider id (scoped by account), then puts the row back to held and answers 'failed' (fix round 1 item 2; mutation: skip the rollback delete → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockRejectedValue(new Error("down"));
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: false, error: "failed" });
    expect(dbMock.deleteInboundMessageByProviderId).toHaveBeenCalledWith(SERVICE, ACCOUNT, HELD.providerEmailId);
    expect(dbMock.decideInboundEmail).toHaveBeenLastCalledWith(SERVICE, ACCOUNT, "ie_1", "filed", { status: "held", messageId: null, decidedBy: null });
  });

  it("ensureConversation throwing BEFORE the compare-and-set claims nothing: no rollback delete, no decide-back attempt (fix round 2 item 1; mutation: roll back unconditionally → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    getContactResult.mockResolvedValue({ id: "pat" });
    dbMock.ensureConversation.mockRejectedValue(new Error("down"));
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", "pat")).toEqual({ ok: false, error: "failed" });
    expect(dbMock.deleteInboundMessageByProviderId).not.toHaveBeenCalled();
    expect(dbMock.decideInboundEmail).not.toHaveBeenCalled();
  });

  it("the compare-and-set itself throwing (not merely returning false) also claims nothing: no rollback delete, and decideInboundEmail is never called a second time to revert it (fix round 2 item 1; mutation: set claimed before the CAS resolves → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockRejectedValue(new Error("down"));
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: false, error: "failed" });
    expect(dbMock.deleteInboundMessageByProviderId).not.toHaveBeenCalled();
    expect(dbMock.decideInboundEmail).toHaveBeenCalledTimes(1);
  });

  it("any throw anywhere in the body answers 'failed', never an unhandled rejection — a malformed contactId that makes the request-client existence check itself throw (fix round 1 item 5; mutation: drop the outer try/catch → the throw escapes, FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    getContactResult.mockRejectedValue(new Error("invalid input syntax for type uuid"));
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", "")).toEqual({ ok: false, error: "failed" });
  });
});

describe("dismiss and the Undos", () => {
  it("Not a customer → dismissed; its Undo → held; File's Undo → unfile (mutation: Undo of dismiss calls unfile → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: true, undo: { kind: "undismiss", id: "ie_1" } });
    requestRow.mockResolvedValue({ ...HELD, status: "dismissed" });
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "undismiss", id: "ie_1" })).toEqual({ ok: true });
    expect(dbMock.decideInboundEmail).toHaveBeenLastCalledWith(SERVICE, ACCOUNT, "ie_1", "dismissed", { status: "held", decidedBy: null });
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "unfile", id: "ie_1", messageId: "msg_1" })).toEqual({ ok: true });
    expect(dbMock.unfileInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "msg_1");
    // No eventId on this undo payload (the File recorded no stop) — the reversal step never runs.
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
  });

  it("Undo of a File that recorded a stop binds FIRST (finds the message carrying the eventId AND the exact messageId), then unfiles, and reverses the stop only AFTER the unfile succeeds (fix round 2 items 2, 3; mutation: drop the stop-reversal call → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.listMessages.mockResolvedValue([
      message({ id: "msg_1", meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" })).toEqual({ ok: true });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, HELD_CONTACT, USER, "en");
    expect(staffMock.undoInboundStop).toHaveBeenCalledWith(CTX, "ev_1");
    expect(dbMock.unfileInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "msg_1");
    // The reversal ran strictly AFTER the unfile call, not before it.
    const unfileOrder = dbMock.unfileInboundEmail.mock.invocationCallOrder[0]!;
    const reversalOrder = staffMock.undoInboundStop.mock.invocationCallOrder[0]!;
    expect(unfileOrder).toBeLessThan(reversalOrder);
  });

  it("unfile refused: the stop reversal is never attempted at all (fix round 2 item 2; mutation: call undoInboundStop before checking unfile's result → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.listMessages.mockResolvedValue([
      message({ id: "msg_1", meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    dbMock.unfileInboundEmail.mockResolvedValue(false);
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" })).toEqual({ ok: false });
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(staffMock.undoInboundStop).not.toHaveBeenCalled();
  });

  it("a refused stop reversal (expired, or changed since) still unfiles the File, reported via stopNotReversed rather than blocked (mutation: skip the unfile when the reversal fails → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.listMessages.mockResolvedValue([
      message({ id: "msg_1", meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: false, error: "Their emails changed while you were looking. This is where they stand now." });
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" }))
      .toEqual({ ok: true, stopNotReversed: "Their emails changed while you were looking. This is where they stand now." });
    expect(dbMock.unfileInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "msg_1");
  });

  it("the message carrying the eventId exists but under a DIFFERENT id than undo.messageId names: no fallback, no reversal, stopNotReversed set to the changed sentence (fix round 2 item 3; mutation: fall back to the suggestion contact → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.listMessages.mockResolvedValue([
      message({ id: "msg_DIFFERENT", meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" }))
      .toEqual({ ok: true, stopNotReversed: m["conversations.held.changed"] });
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(staffMock.undoInboundStop).not.toHaveBeenCalled();
  });

  // S-10 T9a: `stopNotReversed`'s own value is internal (never shown verbatim — see
  // held-email-handlers.ts), but it is now built with the reader's own locale too, same as every
  // other string this file returns (mutation: build it with "en" regardless of locale → FAILS).
  it("in Spanish: the unbound-reversal fallback is Spanish (mutation: build it with \"en\" regardless of locale → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.listMessages.mockResolvedValue([
      message({ id: "msg_DIFFERENT", meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, "es", { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" }))
      .toEqual({ ok: true, stopNotReversed: t(m, "conversations.held.changed", "es") });
  });

  it("in Spanish: the stop reversal's own context is built with the reader's locale, never a hard-coded \"en\" (mutation: pass \"en\" to emailContextFor regardless of locale → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.listMessages.mockResolvedValue([
      message({ id: "msg_1", meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    await undoHeldEmailAction(ACCOUNT, "es", { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, HELD_CONTACT, USER, "es");
  });

  it("no message on the thread carries the eventId at all (listMessages answers []): no reversal, stopNotReversed set to the changed sentence (fix round 2 item 3; mutation: skip setting stopNotReversed when unbound → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.listMessages.mockResolvedValue([]);
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "unfile", id: "ie_1", messageId: "msg_1", eventId: "ev_1" }))
      .toEqual({ ok: true, stopNotReversed: m["conversations.held.changed"] });
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(staffMock.undoInboundStop).not.toHaveBeenCalled();
  });

  it("a row the caller cannot see (a Technician's other customer) is refused before any service write (mutation: read the row on the service client → FAILS)", async () => {
    requestRow.mockResolvedValue(null);
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: false, error: "changed" });
    expect(dbMock.decideInboundEmail).not.toHaveBeenCalled();
  });

  it("dismissHeldEmailAction: any throw anywhere in the body answers 'failed' (fix round 1 item 5; mutation: let the throw escape → FAILS)", async () => {
    requestRow.mockRejectedValue(new Error("db outage"));
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: false, error: "failed" });
  });

  it("undoHeldEmailAction: any throw anywhere in the body answers { ok: false }, never { ok: false, error } (fix round 1 item 5; mutation: let the throw escape → FAILS)", async () => {
    requestRow.mockRejectedValue(new Error("db outage"));
    expect(await undoHeldEmailAction(ACCOUNT, "en", { kind: "undismiss", id: "ie_1" })).toEqual({ ok: false });
  });

  it("provedRow's own conversation read failing (an outage, not a miss) answers 'failed', never 'changed' (fix round 1 minor; mutation: ignore the read's error → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    CONV_READ_ERROR.value = "outage";
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: false, error: "failed" });
  });
});
