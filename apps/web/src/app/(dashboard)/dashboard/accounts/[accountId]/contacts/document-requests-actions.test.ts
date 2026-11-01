import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { requestToken, tokenHash } from "@/lib/document-requests/token";

/**
 * "Ask the customer" (spec 4.2), the staff side. One shared call log tags every database call with
 * the client it ran on, so "the request client first" is an ORDER assertion, not a hope.
 */
type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const calls: string[] = [];
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
const REQUEST = { tag: "request" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const LEDGER = { tag: "ledger" };
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => { calls.push("ledgerDb"); return LEDGER; } }));
// The account's language, the one direct read the action makes on the service client.
const accountRead = vi.fn<(...read: string[]) => Promise<{ data: { language: string | null } | null; error: { message: string } | null }>>();
const SERVICE = {
  tag: "service",
  from: (t: string) => {
    calls.push(`from:${t}:service`);
    return { select: (c: string) => ({ eq: (k: string, v: string) => ({ maybeSingle: () => accountRead(t, c, k, v) }) }) };
  },
};
const tagOf = (c: unknown) => (c as { tag?: string } | null)?.tag ?? "?";
const spy = () => vi.fn<(...a: unknown[]) => Promise<unknown>>();
const h = {
  getContact: spy(), readGroup: spy(), documentRequestTarget: spy(), createDocumentRequest: spy(), getDocumentRequest: spy(),
  revokeDocumentRequest: spy(), restoreDocumentRequest: spy(), deliverDocumentRequest: spy(), requestChannels: spy(),
};
const serviceDb = vi.fn(() => { calls.push("serviceDb"); return SERVICE; });
/** Every spy records `<name>:<client tag>` before answering. */
const wrap = (name: keyof typeof h) => (...a: unknown[]) => { calls.push(`${name}:${tagOf(a[0])}`); return h[name](...a); };
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    ...real, serviceDb: () => serviceDb(),
    getContact: wrap("getContact"), readGroup: wrap("readGroup"), documentRequestTarget: wrap("documentRequestTarget"),
    createDocumentRequest: wrap("createDocumentRequest"), getDocumentRequest: wrap("getDocumentRequest"),
    revokeDocumentRequest: wrap("revokeDocumentRequest"), restoreDocumentRequest: wrap("restoreDocumentRequest"),
  };
});
vi.mock("@/lib/document-requests/deliver", () => ({
  deliverDocumentRequest: wrap("deliverDocumentRequest"), requestChannels: wrap("requestChannels"),
}));
const hdrs: { value: Headers } = { value: new Headers() };
vi.mock("next/headers", () => ({ headers: async () => hdrs.value }));
const A = await import("./document-requests-actions");
const { m } = await import("@/lib/messages");

const SECRET = "bis_unit_document_link_fixture_only_000000000";
const ORIGIN = "https://app.example.com";
const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-15T12:00:00.000Z");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAFF: Access = { userId: "user_staff", isAgency: false, role: "staff", canManage: false };
const ITEMS = [{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "  Roof photo  " }];
const TARGET = { name: "Ana Ruiz", contactId: C, language: "es", phone: "+19565550123", email: "ana@example.com", phoneCountryUnconfirmed: false };
const row = (over: Record<string, unknown> = {}) => ({
  id: R, account_id: ACC, contact_id: C, client_group_id: null, items: [{ key: "id", category: "id", note: null }], language: "es",
  channel: "text", created_by: "user_staff", created_at: "2026-10-14T12:00:00.000Z", expires_at: "2026-10-21T12:00:00.000Z",
  revoked_at: null, revoked_by: null, completed_at: null, sent_at: null, ...over,
});
/** No longer open, each its own way (documentRequestState's order: revoked, completed, expired). */
const NOT_OPEN = [{ revoked_at: "2026-10-15T00:00:00Z", revoked_by: "user_staff" }, { completed_at: "2026-10-15T00:00:00Z" }, { expires_at: "2026-10-15T11:59:59.000Z" }];
const REVOKED_AT = "2026-10-15T12:00:00.000Z";
/** The row as the request client reads it right after this user's revoke at REVOKED_AT. */
const revoked = (over: Record<string, unknown> = {}) => row({ revoked_at: REVOKED_AT, revoked_by: "user_staff", ...over });
const create = (over: Partial<{ record: unknown; items: unknown; channel: unknown }> = {}) =>
  A.createDocumentRequestAction(ACC, { record: { kind: "contact", id: C }, items: ITEMS, channel: "link", ...over } as Parameters<typeof A.createDocumentRequestAction>[1]);
const svcCalls = () => calls.filter((c) => c.endsWith(":service") || c === "serviceDb" || c === "ledgerDb");

let errSpy: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  vi.stubEnv("DOCUMENT_LINK_SECRET", SECRET);
  vi.stubEnv("APP_ORIGIN", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  calls.length = 0;
  hdrs.value = new Headers({ host: "app.example.com", "x-forwarded-proto": "https" });
  for (const f of Object.values(h)) f.mockReset();
  requireAccountAccess.mockReset();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  requireAccountAccess.mockResolvedValue(STAFF);
  h.getContact.mockResolvedValue({ id: C });
  h.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Casa Ruiz", billingAddress: null });
  h.documentRequestTarget.mockResolvedValue(TARGET);
  h.requestChannels.mockResolvedValue({ text: true, email: true });
  accountRead.mockReset();
  accountRead.mockResolvedValue({ data: { language: "en" }, error: null });
  h.createDocumentRequest.mockImplementation(async (...a: unknown[]) => row({ id: (a[1] as { id: string }).id }));
  h.deliverDocumentRequest.mockResolvedValue({ kind: "sent" });
  h.getDocumentRequest.mockResolvedValue(row());
  h.revokeDocumentRequest.mockResolvedValue({ revokedAt: "2026-10-15T12:00:00.000Z" });
  h.restoreDocumentRequest.mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  errSpy.mockRestore();
});

describe("createDocumentRequestAction (spec 4.2)", () => {
  it("1. an invalid record, items cleanRequestItems refuses, or a channel outside text/email/link is refused with NO service call (mutation: skip cleanRequestItems -> FAILS)", async () => {
    const bad: Partial<{ record: unknown; items: unknown; channel: unknown }>[] = [
      { record: { kind: "company", id: C } }, { record: { kind: "contact", id: "nope" } }, { record: null },
      // A note on a category that takes none, a duplicate category, no items, and not a list.
      { items: [{ key: "id", category: "id", note: "x" }] }, { items: [ITEMS[0], ITEMS[0]] }, { items: [] }, { items: "id" },
      { channel: "fax" }, { channel: undefined },
    ];
    for (const b of bad) expect(await create(b), JSON.stringify(b)).toEqual({ ok: false, error: "documents.request.refused" });
    expect(svcCalls()).toEqual([]);
    expect(h.createDocumentRequest).not.toHaveBeenCalled();
  });

  it("2. the record is proven on the REQUEST client before anything on the service client (mutation: service first -> FAILS)", async () => {
    await create({ channel: "text" });
    expect(h.getContact).toHaveBeenCalledWith(REQUEST, ACC, C);
    const first = calls.findIndex((c) => c.endsWith(":service") || c === "serviceDb" || c === "ledgerDb");
    expect(first).toBeGreaterThan(-1);
    expect(calls.indexOf("getContact:request")).toBeGreaterThan(-1);
    expect(calls.indexOf("getContact:request")).toBeLessThan(first);
  });
  it("2b. a group is proven with readGroup on the request client (mutation: prove every record with getContact -> FAILS)", async () => {
    await create({ record: { kind: "group", id: G } });
    expect(h.readGroup).toHaveBeenCalledWith(REQUEST, ACC, G);
    expect(h.getContact).not.toHaveBeenCalled();
    expect(h.documentRequestTarget).toHaveBeenCalledWith(REQUEST, ACC, { contact_id: null, client_group_id: G });
  });
  it("2c. a record the request client cannot see is 'not found' and nothing touches the service client (mutation: treat null as visible -> FAILS)", async () => {
    h.getContact.mockResolvedValue(null);
    expect(await create({ channel: "text" })).toEqual({ ok: false, error: "documents.error.notFound" });
    expect(svcCalls()).toEqual([]);
    h.readGroup.mockResolvedValue(null);
    expect(await create({ record: { kind: "group", id: G } })).toEqual({ ok: false, error: "documents.error.notFound" });
    expect(svcCalls()).toEqual([]);
  });

  it("3. a fresh uuid, the token's HASH (never the token), the CONTACT's language over the account's, the channel, the user, and the link built from the id (mutations: the account's language -> FAILS; store the token -> FAILS)", async () => {
    const res = await create({ channel: "link" });
    expect(h.createDocumentRequest).toHaveBeenCalledTimes(1);
    const [client, arg] = h.createDocumentRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(client).toBe(SERVICE);
    const id = arg.id as string;
    expect(id).toMatch(UUID_RE);
    expect(arg).toEqual({
      id, accountId: ACC, record: { kind: "contact", id: C },
      items: [{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "Roof photo" }],
      language: "es", tokenHash: tokenHash(requestToken(id)), channel: "link", createdBy: "user_staff", now: NOW,
    });
    expect(accountRead).toHaveBeenCalledWith("accounts", "language", "id", ACC);
    const token = requestToken(id);
    expect(res).toEqual({ ok: true, requestId: id, url: `${ORIGIN}/d/${token}`, delivery: { kind: "link" } });
    // The database never receives the token: no argument of any database or delivery call carries it.
    const everyArg = JSON.stringify(Object.values(h).flatMap((f) => f.mock.calls));
    expect(everyArg).not.toContain(token);
    // A second create mints a different id.
    await create({ channel: "link" });
    expect((h.createDocumentRequest.mock.calls[1]![1] as { id: string }).id).not.toBe(id);
  });
  it("3b. no contact language: the account's language, then English (mutation: always 'en' -> FAILS)", async () => {
    h.documentRequestTarget.mockResolvedValue({ ...TARGET, language: null });
    accountRead.mockResolvedValue({ data: { language: "es" }, error: null });
    await create();
    expect((h.createDocumentRequest.mock.calls[0]![1] as { language: string }).language).toBe("es");
    accountRead.mockResolvedValue({ data: { language: null }, error: null });
    await create();
    expect((h.createDocumentRequest.mock.calls[1]![1] as { language: string }).language).toBe("en");
  });
  it("3c. an unreadable account language is 'couldn't create', and nothing is written (mutation: ignore the read error -> FAILS)", async () => {
    accountRead.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await create()).toEqual({ ok: false, error: "documents.request.failed" });
    expect(h.createDocumentRequest).not.toHaveBeenCalled();
  });

  it("4. a link create sends nothing and answers delivery 'link' (mutation: deliver every channel -> FAILS)", async () => {
    const res = await create({ channel: "link" });
    expect(h.deliverDocumentRequest).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, delivery: { kind: "link" } });
  });
  it("4b. a text create delivers once with the created row, the user, the origin and the same instant, and returns its outcome (mutation: pass the account's id as actor -> FAILS)", async () => {
    const res = await create({ channel: "text" });
    expect(h.deliverDocumentRequest).toHaveBeenCalledTimes(1);
    const [client, arg] = h.deliverDocumentRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(client).toBe(SERVICE);
    const id = (h.createDocumentRequest.mock.calls[0]![1] as { id: string }).id;
    expect(arg).toEqual({ request: row({ id }), channel: "text", actorId: "user_staff", origin: ORIGIN, now: NOW });
    expect(res).toEqual({ ok: true, requestId: id, url: `${ORIGIN}/d/${requestToken(id)}`, delivery: { kind: "sent" } });
  });
  it("4c. a blocked or failed send leaves the request STANDING: the answer is ok with that outcome, and nothing revokes it (mutation: undo the request on a failed send -> FAILS)", async () => {
    for (const outcome of [{ kind: "failed" }, { kind: "blocked", reason: "documents.request.reason.textsStopped" }, { kind: "held", until: "2026-10-16T13:00:00.000Z", zone: "America/Chicago" }]) {
      h.deliverDocumentRequest.mockResolvedValueOnce(outcome);
      const res = await create({ channel: "email" });
      expect(res).toMatchObject({ ok: true, delivery: outcome });
    }
    expect(h.revokeDocumentRequest).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.startsWith("from:") && c !== "from:accounts:service")).toEqual([]);
  });
  it("4d. a create that throws is 'couldn't create', logged by account, and never names the link (mutation: let it throw -> FAILS)", async () => {
    h.createDocumentRequest.mockRejectedValue(new Error("insert failed"));
    expect(await create({ channel: "link" })).toEqual({ ok: false, error: "documents.request.failed" });
    const said = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).toContain(ACC);
    expect(said).not.toContain("/d/");
  });

  it("7. the channel is re-checked on the target read on the REQUEST client: text off -> textOff, email off -> emailOff, nothing written; a link never asks (plan review M13; mutation: skip the check -> FAILS)", async () => {
    h.requestChannels.mockResolvedValue({ text: false, email: true });
    expect(await create({ channel: "text" })).toEqual({ ok: false, error: "documents.request.textOff" });
    expect(h.requestChannels).toHaveBeenCalledWith(REQUEST, LEDGER, ACC, TARGET);
    expect(h.documentRequestTarget).toHaveBeenCalledWith(REQUEST, ACC, { contact_id: C, client_group_id: null });
    h.requestChannels.mockResolvedValue({ text: true, email: false });
    expect(await create({ channel: "email" })).toEqual({ ok: false, error: "documents.request.emailOff" });
    expect(h.createDocumentRequest).not.toHaveBeenCalled();
    h.requestChannels.mockClear();
    expect(await create({ channel: "link" })).toMatchObject({ ok: true });
    expect(h.requestChannels).not.toHaveBeenCalled();
  });
  it("7b. a group whose call-first member the caller cannot see offers no text or email: the channels are asked about the target the REQUEST client read (mutation: read the target on the service client -> FAILS)", async () => {
    await create({ record: { kind: "group", id: G }, channel: "text" });
    expect(h.documentRequestTarget.mock.calls.map((c) => c[0])).toEqual([REQUEST]);
    expect(h.requestChannels.mock.calls[0]![0]).toBe(REQUEST);
  });
});

describe("documentRequestLinkAction (Copy link)", () => {
  it("5. an open request read on the REQUEST client answers its link (mutation: read it on the service client -> FAILS)", async () => {
    expect(await A.documentRequestLinkAction(ACC, R.toUpperCase())).toEqual({ ok: true, url: `${ORIGIN}/d/${requestToken(R)}` });
    expect(h.getDocumentRequest).toHaveBeenCalledWith(REQUEST, ACC, R);
    expect(svcCalls()).toEqual([]);
  });
  it("5b. a revoked, completed or expired request answers 'no longer open' (fix round 1; mutations: drop the state check -> FAILS; return the old refused key -> FAILS)", async () => {
    for (const over of NOT_OPEN) {
      h.getDocumentRequest.mockResolvedValueOnce(row(over));
      expect(await A.documentRequestLinkAction(ACC, R), JSON.stringify(over)).toEqual({ ok: false, error: "documents.request.notOpen" });
    }
  });
  it("5c. an invisible or malformed request is refused, and a malformed id reads nothing (mutation: read any id -> FAILS)", async () => {
    h.getDocumentRequest.mockResolvedValueOnce(null);
    expect(await A.documentRequestLinkAction(ACC, R)).toEqual({ ok: false, error: "documents.request.refused" });
    h.getDocumentRequest.mockClear();
    expect(await A.documentRequestLinkAction(ACC, "nope")).toEqual({ ok: false, error: "documents.request.refused" });
    expect(h.getDocumentRequest).not.toHaveBeenCalled();
  });
  it("5d. no origin to build the link on answers the house 'didn't go through' line, never 'couldn't create the request' (fix round 1; mutation: return documents.request.failed -> FAILS)", async () => {
    hdrs.value = new Headers();
    expect(await A.documentRequestLinkAction(ACC, R)).toEqual({ ok: false, error: "common.actionCrashed" });
  });
  it("5e. a read that throws is the same line, logged with the account AND the request id, never the token or the link (fix round 4; mutation: log without the request id -> FAILS)", async () => {
    h.getDocumentRequest.mockRejectedValueOnce(new Error("down"));
    expect(await A.documentRequestLinkAction(ACC, R)).toEqual({ ok: false, error: "common.actionCrashed" });
    const said = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).toContain(`account ${ACC}`);
    expect(said).toContain(`request ${R}`);
    expect(said).not.toContain(requestToken(R));
    expect(said).not.toContain("/d/");
  });
});

describe("the access guard comes first in every action (fix round 2)", () => {
  const REDIRECT = new Error("NEXT_REDIRECT");
  const cases: [string, () => Promise<unknown>][] = [
    ["create", () => create({ channel: "text" })],
    ["Copy link", () => A.documentRequestLinkAction(ACC, R)],
    ["revoke", () => A.revokeDocumentRequestAction(ACC, R)],
    ["Undo", () => A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)],
  ];
  for (const [name, run] of cases) {
    it(`${name}: a rejected requireAccountAccess (a redirect) reads nothing (mutation: drop the guard -> FAILS)`, async () => {
      requireAccountAccess.mockRejectedValue(REDIRECT);
      await expect(run()).rejects.toBe(REDIRECT);
      expect(requireAccountAccess).toHaveBeenCalledWith(ACC);
      expect(calls).toEqual([]);
      expect(accountRead).not.toHaveBeenCalled();
    });
  }
});

describe("the two new answers read in both languages (fix round 1)", () => {
  it("'no longer open', and the house line Copy link answers when it cannot build the link (mutation: change either .es -> FAILS)", () => {
    expect(m["documents.request.notOpen"]).toBe("This request is no longer open.");
    expect(m["documents.request.notOpen.es"]).toBe("Este pedido ya no está abierto.");
    expect(m["common.actionCrashed"]).toBe("That didn't go through — this page may be out of date. Reload it and try again.");
    expect(m["common.actionCrashed.es"]).toBe("Eso no se completó: puede que esta página esté desactualizada. Recárguela e inténtelo de nuevo.");
  });
});

describe("revokeDocumentRequestAction and its Undo (rule 6)", () => {
  it("6. proves the request on the REQUEST client, then revokes on the service client as the user (mutation: revoke before the proof -> FAILS)", async () => {
    expect(await A.revokeDocumentRequestAction(ACC, R)).toEqual({ ok: true, revokedAt: "2026-10-15T12:00:00.000Z" });
    expect(h.getDocumentRequest).toHaveBeenCalledWith(REQUEST, ACC, R);
    expect(h.revokeDocumentRequest).toHaveBeenCalledWith(SERVICE, ACC, R, "user_staff", NOW);
    expect(calls.indexOf("getDocumentRequest:request")).toBeLessThan(calls.indexOf("revokeDocumentRequest:service"));
  });
  it("6b. an invisible request is refused and touches nothing (mutation: treat null as visible -> FAILS)", async () => {
    h.getDocumentRequest.mockResolvedValueOnce(null);
    expect(await A.revokeDocumentRequestAction(ACC, R)).toEqual({ ok: false, error: "documents.request.refused" });
    expect(svcCalls()).toEqual([]);
  });
  it("6b2. a revoked, completed or expired request answers 'no longer open' before any write; a revoke that lost the race (null) too (fix round 1; mutations: return the old refused key -> FAILS; drop the state check -> FAILS)", async () => {
    for (const over of NOT_OPEN) {
      h.getDocumentRequest.mockResolvedValueOnce(row(over));
      expect(await A.revokeDocumentRequestAction(ACC, R), JSON.stringify(over)).toEqual({ ok: false, error: "documents.request.notOpen" });
    }
    expect(h.revokeDocumentRequest).not.toHaveBeenCalled();
    h.revokeDocumentRequest.mockResolvedValueOnce(null);
    expect(await A.revokeDocumentRequestAction(ACC, R)).toEqual({ ok: false, error: "documents.request.notOpen" });
  });
  it("6c. Undo restores exactly the revoke it was given, after the same proof (mutation: undo with now -> FAILS)", async () => {
    h.getDocumentRequest.mockResolvedValue(revoked());
    vi.setSystemTime(new Date("2026-10-15T12:00:07.000Z"));
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)).toEqual({ ok: true });
    expect(h.restoreDocumentRequest).toHaveBeenCalledWith(SERVICE, ACC, R, REVOKED_AT);
    expect(calls.indexOf("getDocumentRequest:request")).toBeLessThan(calls.indexOf("restoreDocumentRequest:service"));
  });
  it("6c2. Undo that lost the race, of a request no longer revoked, of a DIFFERENT revoke, or of one since completed or expired answers 'no longer open' (fix round 1; mutation: return the old refused key -> FAILS)", async () => {
    vi.setSystemTime(new Date("2026-10-15T12:00:07.000Z"));
    h.getDocumentRequest.mockResolvedValue(revoked());
    h.restoreDocumentRequest.mockResolvedValueOnce(false);
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)).toEqual({ ok: false, error: "documents.request.notOpen" });
    h.restoreDocumentRequest.mockClear();
    for (const over of [{ revoked_at: null, revoked_by: null }, { revoked_at: "2026-10-15T11:59:00.000Z" },
      { completed_at: "2026-10-15T12:00:05.000Z" }, { expires_at: "2026-10-15T12:00:06.000Z" }]) {
      h.getDocumentRequest.mockResolvedValueOnce(revoked(over));
      expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT), JSON.stringify(over)).toEqual({ ok: false, error: "documents.request.notOpen" });
    }
    expect(h.restoreDocumentRequest).not.toHaveBeenCalled();
  });
  it("6e. Undo is the revoker's own: someone else's revoke answers 'no longer open' and restores nothing (fix round 3; mutation: drop the revoked_by check -> FAILS)", async () => {
    vi.setSystemTime(new Date("2026-10-15T12:00:07.000Z"));
    h.getDocumentRequest.mockResolvedValue(revoked({ revoked_by: "user_other" }));
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)).toEqual({ ok: false, error: "documents.request.notOpen" });
    expect(h.restoreDocumentRequest).not.toHaveBeenCalled();
  });
  it("6f. Undo lives 10 minutes: 9:59 after the revoke restores, 10:01 answers 'no longer open' and restores nothing (fix round 3; mutation: drop the window -> FAILS)", async () => {
    h.getDocumentRequest.mockResolvedValue(revoked());
    vi.setSystemTime(new Date("2026-10-15T12:09:59.000Z"));
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)).toEqual({ ok: true });
    h.restoreDocumentRequest.mockClear();
    vi.setSystemTime(new Date("2026-10-15T12:10:01.000Z"));
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)).toEqual({ ok: false, error: "documents.request.notOpen" });
    expect(h.restoreDocumentRequest).not.toHaveBeenCalled();
  });
  it("6g. an invisible request, or no revoke time, is refused and restores nothing (mutation: skip the proof -> FAILS)", async () => {
    h.getDocumentRequest.mockResolvedValueOnce(null);
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)).toEqual({ ok: false, error: "documents.request.refused" });
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, "")).toEqual({ ok: false, error: "documents.request.refused" });
    expect(h.restoreDocumentRequest).not.toHaveBeenCalled();
  });
  it("6d. a write that throws is 'couldn't save', never a throw, and the log names the account AND the request, never its link (fix round 4; mutations: let it throw -> FAILS; log without the request id -> FAILS)", async () => {
    h.revokeDocumentRequest.mockRejectedValueOnce(new Error("down"));
    expect(await A.revokeDocumentRequestAction(ACC, R)).toEqual({ ok: false, error: "documents.error.failed" });
    const revokeSaid = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(revokeSaid).toContain(`account ${ACC}`);
    expect(revokeSaid).toContain(`request ${R}`);
    errSpy.mockClear();
    vi.setSystemTime(new Date("2026-10-15T12:00:07.000Z"));
    h.getDocumentRequest.mockResolvedValue(revoked());
    h.restoreDocumentRequest.mockRejectedValueOnce(new Error("down"));
    expect(await A.undoRevokeDocumentRequestAction(ACC, R, REVOKED_AT)).toEqual({ ok: false, error: "documents.error.failed" });
    const undoSaid = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(undoSaid).toContain(`account ${ACC}`);
    expect(undoSaid).toContain(`request ${R}`);
    expect(revokeSaid + undoSaid).not.toContain(requestToken(R));
  });
});
