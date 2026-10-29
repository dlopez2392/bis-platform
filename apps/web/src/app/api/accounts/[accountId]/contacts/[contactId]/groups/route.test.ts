import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiAccountAccess } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ apiAccountAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => ({ request: true })) }));
const db = { getContact: vi.fn(), listContactGroups: vi.fn() };
vi.mock("@bis/db", () => db);
const noteOpenedApi = vi.fn(async () => true);
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi: (...a: unknown[]) => noteOpenedApi(...(a as [])) }));
const { GET } = await import("./route");
const C = "11111111-1111-4111-8111-111111111111";
const call = (contactId = C) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: "a1", contactId }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiAccountAccess).mockResolvedValue({ userId: "u", isAgency: false });
  db.listContactGroups.mockResolvedValue([{ memberId: "m" }]);
  noteOpenedApi.mockResolvedValue(true);
});

describe("GET groups", () => {
  it("404s a contact the request client cannot see, reading nothing else (mutation: drop the getContact check -> FAILS)", async () => {
    db.getContact.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect(db.getContact).toHaveBeenCalledWith({ request: true }, "a1", C);
    expect(db.listContactGroups).not.toHaveBeenCalled();
  });
  it("returns the contact's groups", async () => {
    db.getContact.mockResolvedValueOnce({ id: C });
    expect(await (await call()).json()).toEqual({ groups: [{ memberId: "m" }] });
    expect(db.listContactGroups).toHaveBeenCalledWith({ request: true }, "a1", C);
  });
  it("404s a caller with no access to the account, reading nothing (m5)", async () => {
    vi.mocked(apiAccountAccess).mockResolvedValueOnce(null);
    db.getContact.mockResolvedValue({ id: C });
    expect((await call()).status).toBe(404);
    expect(db.getContact).not.toHaveBeenCalled();
  });
  it("404s a contact id that is not a uuid, never asking the database (m6)", async () => {
    db.getContact.mockResolvedValue({ id: "nope" });
    expect((await call("nope")).status).toBe(404);
    expect(db.getContact).not.toHaveBeenCalled();
  });
});

describe("F-118 part 1 (plan Task 6): BIS's open of this card is logged", () => {
  beforeEach(() => {
    vi.mocked(apiAccountAccess).mockResolvedValue({ userId: "u", isAgency: true });
    db.getContact.mockResolvedValue({ id: C });
  });
  it("logged after the proof, with the same access object (mutation: hard-code { isAgency: false } -> FAILS)", async () => {
    await call();
    expect(noteOpenedApi).toHaveBeenCalledTimes(1);
    expect(noteOpenedApi).toHaveBeenCalledWith({ userId: "u", isAgency: true }, "a1", { kind: "contact", recordId: C });
  });
  it("a 404 logs nothing (mutation: move the call above the proof -> FAILS)", async () => {
    db.getContact.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect(noteOpenedApi).not.toHaveBeenCalled();
  });
  it("no live visit: 404, and the first data read never ran (mutation: ignore the false -> FAILS)", async () => {
    noteOpenedApi.mockResolvedValueOnce(false);
    const res = await call();
    expect(res.status).toBe(404);
    expect(db.listContactGroups).not.toHaveBeenCalled();
  });
  it("the write rejects: a status >= 500, and the first data read never ran (mutation: try/catch around the call -> FAILS)", async () => {
    noteOpenedApi.mockRejectedValueOnce(new Error("db down"));
    const status = await call().then((r) => r.status, () => 500);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(db.listContactGroups).not.toHaveBeenCalled();
  });
});
