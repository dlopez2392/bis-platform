import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ apiAccountAccess: vi.fn(async () => ({ userId: "u", isAgency: false })) }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => ({ request: true })) }));
const db = { getContact: vi.fn(), listContactGroups: vi.fn(async () => [{ memberId: "m" }]) };
vi.mock("@bis/db", () => db);
const { GET } = await import("./route");
const call = () => GET(new Request("http://x"), { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) });

describe("GET groups", () => {
  it("404s a contact the request client cannot see, reading nothing else (mutation: drop the getContact check -> FAILS)", async () => {
    db.getContact.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect(db.listContactGroups).not.toHaveBeenCalled();
  });
  it("returns the contact's groups", async () => {
    db.getContact.mockResolvedValueOnce({ id: "c1" });
    expect(await (await call()).json()).toEqual({ groups: [{ memberId: "m" }] });
  });
});
