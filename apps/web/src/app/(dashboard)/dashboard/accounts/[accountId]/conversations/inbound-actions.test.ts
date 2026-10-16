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

const dbMock = vi.hoisted(() => ({
  readConsentHistory: vi.fn(),
  newestDecidingRow: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("@bis/db", () => dbMock);

const ctxMock = vi.hoisted(() => ({ emailContextFor: vi.fn() }));
vi.mock("@/lib/consent/email-context", () => ctxMock);

const staffMock = vi.hoisted(() => ({ undoInboundStop: vi.fn(), stopEmails: vi.fn() }));
vi.mock("@/lib/consent/email-staff-actions", () => staffMock);

import { undoReplyStopAction, stopEmailsFromReplyAction } from "./inbound-actions";

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
