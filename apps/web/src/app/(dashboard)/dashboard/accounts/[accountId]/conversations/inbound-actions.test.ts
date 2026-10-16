import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ACCOUNT = "acc_1";
const USER = "user_1";
const CTX = { tag: "ctx" } as never;

const requireAccountAccessMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (...a: unknown[]) => requireAccountAccessMock(...a),
}));

// The request client's own answer to `provedThread`'s
// `from("conversations").select("id, contact_id").eq(...).eq(...).maybeSingle()`
// chain (built the way conversations/actions.test.ts builds its `dbForRequest`
// fake). A test sets its resolved value directly.
const convRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: convRead,
          }),
        }),
      }),
    }),
  }),
}));

const dbMock = vi.hoisted(() => ({
  readConsentEvent: vi.fn(),
  readConsentHistory: vi.fn(),
  newestDecidingRow: vi.fn(),
  serviceDb: vi.fn(() => ({ tag: "service-db" })),
}));
vi.mock("@bis/db", () => dbMock);

const ctxMock = vi.hoisted(() => ({ emailContextFor: vi.fn() }));
vi.mock("@/lib/consent/email-context", () => ctxMock);

const staffMock = vi.hoisted(() => ({ undoInboundStop: vi.fn(), stopEmails: vi.fn() }));
vi.mock("@/lib/consent/email-staff-actions", () => staffMock);

import { undoReplyStopAction, stopEmailsFromReplyAction } from "./inbound-actions";

beforeEach(() => {
  requireAccountAccessMock.mockReset().mockResolvedValue({ userId: USER });
  convRead.mockReset();
  dbMock.readConsentEvent.mockReset();
  dbMock.readConsentHistory.mockReset();
  dbMock.newestDecidingRow.mockReset();
  ctxMock.emailContextFor.mockReset();
  staffMock.undoInboundStop.mockReset();
  staffMock.stopEmails.mockReset();
});

describe("undoReplyStopAction", () => {
  it("proves the conversation on the request client, then builds the context for the STOP's own contact (a household member's) and undoes (mutation: use the thread's contact → wrong address, FAILS)", async () => {
    convRead.mockResolvedValue({ data: { id: "conv", contact_id: "ana" }, error: null });
    dbMock.readConsentEvent.mockResolvedValue({ id: "ev_1", contact_id: "luis", channel: "email", action: "revoked", method: "inbound_email" });
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });

    expect(await undoReplyStopAction(ACCOUNT, "conv", "ev_1")).toEqual({ ok: true });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER);
    expect(staffMock.undoInboundStop).toHaveBeenCalledWith(CTX, "ev_1");
  });

  it("a conversation the caller cannot see is refused before any service read (mutation: skip the proof → FAILS)", async () => {
    convRead.mockResolvedValue({ data: null, error: null });

    expect((await undoReplyStopAction(ACCOUNT, "conv", "ev_1")).ok).toBe(false);
    expect(dbMock.readConsentEvent).not.toHaveBeenCalled();
  });
});

describe("stopEmailsFromReplyAction", () => {
  it("stops the sender's emails over the newest row it reads now (a fresh click; mutation: pass null as expectNewest always → refused over an allowed history, FAILS)", async () => {
    convRead.mockResolvedValue({ data: { id: "conv", contact_id: "ana" }, error: null });
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    dbMock.readConsentHistory.mockResolvedValue([{ id: "ev_0", action: "resubscribed", method: "staff", occurred_at: "x" }]);
    dbMock.newestDecidingRow.mockReturnValue({ id: "ev_0", action: "resubscribed" });
    staffMock.stopEmails.mockResolvedValue({ ok: true, view: {} });

    expect(await stopEmailsFromReplyAction(ACCOUNT, "conv", "ana")).toEqual({ ok: true });
    expect(staffMock.stopEmails).toHaveBeenCalledWith(CTX, "ev_0");
  });
});
