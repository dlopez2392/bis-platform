import { describe, it, expect, vi, beforeEach } from "vitest";

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

const ctxMock = vi.hoisted(() => ({ emailContextFor: vi.fn() }));
vi.mock("@/lib/consent/email-context", () => ctxMock);

const staffMock = vi.hoisted(() => ({ undoInboundStop: vi.fn(), stopEmails: vi.fn() }));
vi.mock("@/lib/consent/email-staff-actions", () => staffMock);

import { undoReplyStopAction, stopEmailsFromReplyAction, fileHeldEmailAction, dismissHeldEmailAction, undoHeldEmailAction } from "./inbound-actions";

const message = (over: Partial<{ channel: string; direction: string; meta: unknown }> = {}) => ({
  channel: "email", direction: "inbound", meta: {}, ...over,
});

beforeEach(() => {
  requireAccountAccessMock.mockReset().mockResolvedValue({ userId: USER });
  CONV_ROW.value = { id: CONV, contact_id: "ana" };
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
  dbMock.getContact.mockReset();
  fileMock.fileInboundEmail.mockReset();
});

describe("undoReplyStopAction", () => {
  it("binds the eventId to the message that actually carries it on THIS thread, and undoes for that message's sender (a household member), not the thread's own contact (mutation: use the thread's contact → wrong address, FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { sender: { contact_id: "luis" }, consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });

    expect(await undoReplyStopAction(ACCOUNT, CONV, "ev_1")).toEqual({ ok: true });
    expect(dbMock.listMessages).toHaveBeenCalledWith(expect.objectContaining({ tag: "request-db" }), ACCOUNT, CONV);
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER);
    expect(staffMock.undoInboundStop).toHaveBeenCalledWith(CTX, "ev_1");
  });

  it("a conversation the caller cannot see is refused before any thread read (mutation: skip the proof → FAILS)", async () => {
    CONV_ROW.value = null;

    const result = await undoReplyStopAction(ACCOUNT, CONV, "ev_1");
    expect(result.ok).toBe(false);
    expect(dbMock.listMessages).not.toHaveBeenCalled();
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(staffMock.undoInboundStop).not.toHaveBeenCalled();
  });

  it("an eventId not carried by any message on this thread is refused, never reaching emailContextFor (mutation: skip the binding check → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { consent: { kind: "stopped", eventId: "ev_OTHER" } } }),
    ]);

    const result = await undoReplyStopAction(ACCOUNT, CONV, "ev_1");
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

    expect(await undoReplyStopAction(ACCOUNT, CONV, "ev_1")).toEqual({ ok: true });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "ana", USER);
  });

  it("passes undoInboundStop's typed expired flag through, never by matching the error string (mutation: drop the pass-through → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: false, error: "Only the customer can turn these emails back on.", expired: true });

    expect(await undoReplyStopAction(ACCOUNT, CONV, "ev_1")).toEqual({
      ok: false, error: "Only the customer can turn these emails back on.", expired: true,
    });
  });

  it("a stale-click 'changed' refusal carries no expired flag at all (mutation: always set expired → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([
      message({ meta: { consent: { kind: "stopped", eventId: "ev_1" } } }),
    ]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: false, error: "Their emails changed while you were looking. This is where they stand now." });

    const result = await undoReplyStopAction(ACCOUNT, CONV, "ev_1");
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

    expect(await stopEmailsFromReplyAction(ACCOUNT, CONV, "ana")).toEqual({ ok: true });
    expect(dbMock.readConsentHistory).toHaveBeenCalledWith(CTX.writer, ACCOUNT, "email", CTX.address);
    expect(staffMock.stopEmails).toHaveBeenCalledWith(CTX, "ev_0");
  });

  it("stops a household member's emails when their contactId is bound to a message on this thread (mutation: skip the binding check → FAILS the next case)", async () => {
    dbMock.listMessages.mockResolvedValue([message({ meta: { sender: { contact_id: "luis" } } })]);
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    dbMock.readConsentHistory.mockResolvedValue([]);
    dbMock.newestDecidingRow.mockReturnValue(null);
    staffMock.stopEmails.mockResolvedValue({ ok: true, view: {} });

    expect(await stopEmailsFromReplyAction(ACCOUNT, CONV, "luis")).toEqual({ ok: true });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER);
  });

  it("a contactId that is neither the thread's own contact nor any sender on this thread is refused before any service read (mutation: drop the binding check → FAILS)", async () => {
    dbMock.listMessages.mockResolvedValue([message({ meta: { sender: { contact_id: "luis" } } })]);

    const result = await stopEmailsFromReplyAction(ACCOUNT, CONV, "someone-else");
    expect(result.ok).toBe(false);
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(dbMock.readConsentHistory).not.toHaveBeenCalled();
    expect(staffMock.stopEmails).not.toHaveBeenCalled();
  });

  it("a conversation the caller cannot see is refused before any service read (mutation: skip the proof → FAILS)", async () => {
    CONV_ROW.value = null;

    const result = await stopEmailsFromReplyAction(ACCOUNT, CONV, "ana");
    expect(result.ok).toBe(false);
    expect(ctxMock.emailContextFor).not.toHaveBeenCalled();
    expect(dbMock.readConsentHistory).not.toHaveBeenCalled();
    expect(staffMock.stopEmails).not.toHaveBeenCalled();
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

  it("Choose a record: proves the chosen contact on the request client and files on THAT contact's thread (mutation: file on the suggestion → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.getContact.mockResolvedValue({ id: "pat", first_name: "Pat" });
    dbMock.ensureConversation.mockResolvedValue({ id: "conv_pat", created: false });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_2", created: true, consent: { kind: "none" } });
    await fileHeldEmailAction(ACCOUNT, "ie_1", "pat");
    expect(fileMock.fileInboundEmail.mock.calls[0]![1]).toMatchObject({ contactId: "pat", row: expect.objectContaining({ conversationId: "conv_pat" }) });
    dbMock.getContact.mockResolvedValue(null);
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", "ghost")).toEqual({ ok: false, error: "changed" });
  });

  it("a row someone already moved answers 'changed' and files nothing (mutation: skip the compare-and-set → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(false);
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: false, error: "changed" });
    expect(fileMock.fileInboundEmail).not.toHaveBeenCalled();
  });

  it("a filing failure puts the row back to held and answers 'failed' (mutation: leave it filed → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockRejectedValue(new Error("down"));
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: false, error: "failed" });
    expect(dbMock.decideInboundEmail).toHaveBeenLastCalledWith(SERVICE, ACCOUNT, "ie_1", "filed", { status: "held", messageId: null, decidedBy: null });
  });
});

describe("dismiss and the Undos", () => {
  it("Not a customer → dismissed; its Undo → held; File's Undo → unfile (mutation: Undo of dismiss calls unfile → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: true, undo: { kind: "undismiss", id: "ie_1" } });
    requestRow.mockResolvedValue({ ...HELD, status: "dismissed" });
    expect(await undoHeldEmailAction(ACCOUNT, { kind: "undismiss", id: "ie_1" })).toEqual({ ok: true });
    expect(dbMock.decideInboundEmail).toHaveBeenLastCalledWith(SERVICE, ACCOUNT, "ie_1", "dismissed", { status: "held", decidedBy: null });
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, { kind: "unfile", id: "ie_1", messageId: "msg_1" })).toEqual({ ok: true });
    expect(dbMock.unfileInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "msg_1");
  });

  it("a row the caller cannot see (a Technician's other customer) is refused before any service write (mutation: read the row on the service client → FAILS)", async () => {
    requestRow.mockResolvedValue(null);
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: false, error: "changed" });
    expect(dbMock.decideInboundEmail).not.toHaveBeenCalled();
  });
});
