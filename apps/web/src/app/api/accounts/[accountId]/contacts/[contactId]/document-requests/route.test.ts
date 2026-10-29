import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const apiAccountAccess = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (id: string) => apiAccountAccess(id) }));
const noteOpenedApi = vi.fn(async () => true);
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi: (...a: unknown[]) => noteOpenedApi(...(a as [])) }));
const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const LEDGER = { tag: "ledger-db" };
const ledgerDb = vi.fn(() => LEDGER);
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledgerDb() }));
const requestChannels = vi.fn();
vi.mock("@/lib/document-requests/deliver", () => ({ requestChannels: (...a: unknown[]) => requestChannels(...a) }));
const db = {
  getContact: vi.fn(), readGroup: vi.fn(), listOpenDocumentRequests: vi.fn(), documentRequestTarget: vi.fn(),
  serviceDb: vi.fn(() => { throw new Error("never"); }),
};
vi.mock("@bis/db", () => db);
const { GET } = await import("./route");

const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-15T12:00:00.000Z";
const TARGET = { name: "Ana Ruiz", contactId: C, language: "es", phone: "+19565550123", email: null, phoneCountryUnconfirmed: false };
const OPEN = [{
  id: "33333333-3333-4333-8333-333333333333", channel: "text", createdAt: "2026-10-14T12:00:00.000Z", expiresAt: "2026-10-21T12:00:00.000Z",
  items: [{ key: "id", category: "id", note: null, answered: true }, { key: "other", category: "other", note: "Roof photo", answered: false }],
}];
const call = (id = C) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: ACC, contactId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, "error").mockImplementation(() => {});
  apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false });
  noteOpenedApi.mockResolvedValue(true);
  db.getContact.mockResolvedValue({ id: C });
  db.listOpenDocumentRequests.mockResolvedValue(OPEN);
  db.documentRequestTarget.mockResolvedValue(TARGET);
  requestChannels.mockResolvedValue({ text: true, email: false });
});
afterEach(() => vi.useRealTimers());

describe("the Documents card's requests read for a contact (spec 4.2)", () => {
  it("lists this contact's open requests on the REQUEST client and the channels for the target read there too (mutation: the service client for the list -> FAILS)", async () => {
    const res = await call(C.toUpperCase());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ now: NOW, channels: { text: true, email: false }, requests: OPEN });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, ACC, C);
    expect(db.listOpenDocumentRequests).toHaveBeenCalledWith(REQUEST, ACC, { kind: "contact", id: C }, new Date(NOW));
    expect(db.documentRequestTarget).toHaveBeenCalledWith(REQUEST, ACC, { contact_id: C, client_group_id: null });
    expect(requestChannels).toHaveBeenCalledWith(REQUEST, LEDGER, ACC, TARGET);
  });
  it("404 for no access, a malformed id, or a contact the request client cannot see; nothing else is read (mutation: list before getContact -> FAILS)", async () => {
    db.getContact.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(404);
    apiAccountAccess.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({});
    expect(db.listOpenDocumentRequests).not.toHaveBeenCalled();
    expect(db.documentRequestTarget).not.toHaveBeenCalled();
    expect(ledgerDb).not.toHaveBeenCalled();
  });
  it("a thrown read is a 500 with an empty body, never a partial one (mutation: answer the requests without channels -> FAILS)", async () => {
    requestChannels.mockRejectedValue(new Error("down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({});
    db.listOpenDocumentRequests.mockRejectedValue(new Error("down"));
    expect((await call()).status).toBe(500);
  });
});

describe("F-118 part 1 (plan Task 6): BIS's open of this card is logged", () => {
  beforeEach(() => { apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: true }); });
  it("logged after the proof, with the same access object (mutation: hard-code { isAgency: false } -> FAILS)", async () => {
    await call();
    expect(noteOpenedApi).toHaveBeenCalledTimes(1);
    expect(noteOpenedApi).toHaveBeenCalledWith({ userId: "user_me", isAgency: true }, ACC, { kind: "contact", recordId: C });
  });
  it("a 404 logs nothing (mutation: move the call above the proof -> FAILS)", async () => {
    db.getContact.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(noteOpenedApi).not.toHaveBeenCalled();
  });
  it("no live visit: 404, and the first data read never ran (mutation: ignore the false -> FAILS)", async () => {
    noteOpenedApi.mockResolvedValueOnce(false);
    const res = await call();
    expect(res.status).toBe(404);
    expect(db.listOpenDocumentRequests).not.toHaveBeenCalled();
  });
  it("the write rejects: a status >= 500, and the first data read never ran (mutation: try/catch around the call -> FAILS)", async () => {
    noteOpenedApi.mockRejectedValueOnce(new Error("db down"));
    const status = await call().then((r) => r.status, () => 500);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(db.listOpenDocumentRequests).not.toHaveBeenCalled();
  });
});
