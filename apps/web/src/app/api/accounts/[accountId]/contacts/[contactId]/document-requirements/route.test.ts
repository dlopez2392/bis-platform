import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

const apiAccountAccess = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (id: string) => apiAccountAccess(id) }));
const noteOpenedApi = vi.fn(async () => true);
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi: (...a: unknown[]) => noteOpenedApi(...(a as [])) }));
// The account row the documents clock reads on the SAME request client: its zone decides the day.
const REQUEST = {
  tag: "request-db",
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }) }) }) }),
};
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const db = {
  getContact: vi.fn(), listDocumentRequirements: vi.fn(),
  serviceDb: vi.fn(() => { throw new Error("never"); }),
};
vi.mock("@bis/db", () => db);
// The real zone rule needs the agency fallback (serviceDb); here the stored zone, or UTC when there is none.
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));
const { GET } = await import("./route");

const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const ITEMS = [{ category: "insurance", state: "met" }, { category: "id", state: "missing" }];
const call = (id = C) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: ACC, contactId: id }) });
let errorLog: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // Still 2026-10-16 in Chicago, already the 17th in UTC.
  vi.setSystemTime(new Date("2026-10-17T03:00:00.000Z"));
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false });
  noteOpenedApi.mockResolvedValue(true);
  db.getContact.mockResolvedValue({ id: C });
  db.listDocumentRequirements.mockResolvedValue(ITEMS);
});
afterEach(() => vi.useRealTimers());

describe("the Documents card's checklist read for a contact (spec 5.3)", () => {
  it("answers each required category's state on the ACCOUNT's day, read on the request client (mutation: the UTC day -> FAILS)", async () => {
    const res = await call(C.toUpperCase());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ITEMS });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, ACC, C);
    expect(db.listDocumentRequirements).toHaveBeenCalledWith(REQUEST, ACC, C, "2026-10-16");
  });
  it("answers an empty list when the account requires nothing", async () => {
    db.listDocumentRequirements.mockResolvedValue([]);
    expect(await (await call()).json()).toEqual({ items: [] });
  });
  it("404 for no access, a malformed id, or a contact the request client cannot see; the checklist is never read (mutation: read before getContact -> FAILS)", async () => {
    db.getContact.mockResolvedValue(null);
    const hidden = await call();
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({});
    expect((await call("nope")).status).toBe(404);
    apiAccountAccess.mockResolvedValue(null);
    db.getContact.mockResolvedValue({ id: C });
    expect((await call()).status).toBe(404);
    expect(db.listDocumentRequirements).toHaveBeenCalledTimes(0);
  });
  it("a thrown read is a 500 with an empty body; the log names the account and the contact, never the error's data", async () => {
    const e = Object.assign(new Error("document_requirements failed: boom"), { details: "SECRET-ROW-DATA" });
    db.listDocumentRequirements.mockRejectedValue(e);
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({});
    expect(errorLog).toHaveBeenCalledTimes(1);
    const line = String(errorLog.mock.calls[0]![0]);
    expect(line).toContain(`account ${ACC}`);
    expect(line).toContain(`contact ${C}`);
    expect(line).not.toContain("SECRET-ROW-DATA");
  });
  it("never builds the service client", async () => {
    await call();
    db.getContact.mockResolvedValue(null);
    await call();
    expect(db.serviceDb).toHaveBeenCalledTimes(0);
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
    expect(db.listDocumentRequirements).not.toHaveBeenCalled();
  });
  it("the write rejects: a status >= 500, and the first data read never ran (mutation: try/catch around the call -> FAILS)", async () => {
    noteOpenedApi.mockRejectedValueOnce(new Error("db down"));
    const status = await call().then((r) => r.status, () => 500);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(db.listDocumentRequirements).not.toHaveBeenCalled();
  });
});
