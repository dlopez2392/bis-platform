import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiAccountAccess } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ apiAccountAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => ({ request: true })) }));
const db = { getContact: vi.fn(), listContactGroups: vi.fn() };
vi.mock("@bis/db", () => db);
const { GET } = await import("./route");
const C = "11111111-1111-4111-8111-111111111111";
const call = (contactId = C) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: "a1", contactId }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiAccountAccess).mockResolvedValue({ userId: "u", isAgency: false });
  db.listContactGroups.mockResolvedValue([{ memberId: "m" }]);
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
