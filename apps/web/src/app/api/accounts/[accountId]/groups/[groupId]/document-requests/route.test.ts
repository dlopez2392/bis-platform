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
const G = "22222222-2222-4222-8222-222222222222";
const P = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-15T12:00:00.000Z";
// A group speaks through its call-first member (plan deviation 3).
const TARGET = { name: "Casa Ruiz", contactId: P, language: null, phone: null, email: "casa@example.com", phoneCountryUnconfirmed: null };
const OPEN = [{
  id: "33333333-3333-4333-8333-333333333333", channel: "email", createdAt: "2026-10-14T12:00:00.000Z", expiresAt: "2026-10-21T12:00:00.000Z",
  items: [{ key: "insurance", category: "insurance", note: null, answered: false }],
}];
const call = (id = G) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: ACC, groupId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, "error").mockImplementation(() => {});
  apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false });
  noteOpenedApi.mockResolvedValue(true);
  db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Casa Ruiz", billingAddress: null });
  db.listOpenDocumentRequests.mockResolvedValue(OPEN);
  db.documentRequestTarget.mockResolvedValue(TARGET);
  requestChannels.mockResolvedValue({ text: false, email: true });
});
afterEach(() => vi.useRealTimers());

describe("the Documents card's requests read for a group (spec 4.2)", () => {
  it("proves the group with readGroup, lists its open requests and asks the channels about its call-first member, all on the REQUEST client (mutations: the service client for the list -> FAILS; prove with getContact -> FAILS)", async () => {
    const res = await call(G.toUpperCase());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ now: NOW, channels: { text: false, email: true }, requests: OPEN });
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, ACC, G);
    expect(db.getContact).not.toHaveBeenCalled();
    expect(db.listOpenDocumentRequests).toHaveBeenCalledWith(REQUEST, ACC, { kind: "group", id: G }, new Date(NOW));
    expect(db.documentRequestTarget).toHaveBeenCalledWith(REQUEST, ACC, { contact_id: null, client_group_id: G });
    expect(requestChannels).toHaveBeenCalledWith(REQUEST, LEDGER, ACC, TARGET);
  });
  it("404 for no access, a malformed id, or a group the request client cannot see; nothing else is read (mutation: list before readGroup -> FAILS)", async () => {
    db.readGroup.mockResolvedValue(null);
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
  it("a thrown read is a 500 with an empty body (mutation: catch only the list -> FAILS)", async () => {
    db.documentRequestTarget.mockRejectedValue(new Error("down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({});
  });
});

describe("F-118 part 1 (plan Task 6): BIS's open of this card is logged", () => {
  beforeEach(() => { apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: true }); });
  it("logged after the proof, with the same access object (mutation: hard-code { isAgency: false } -> FAILS)", async () => {
    await call();
    expect(noteOpenedApi).toHaveBeenCalledTimes(1);
    expect(noteOpenedApi).toHaveBeenCalledWith({ userId: "user_me", isAgency: true }, ACC, { kind: "group", recordId: G });
  });
  it("a 404 logs nothing (mutation: move the call above the proof -> FAILS)", async () => {
    db.readGroup.mockResolvedValue(null);
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
