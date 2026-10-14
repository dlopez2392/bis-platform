import { describe, it, expect, vi, beforeEach } from "vitest";

const apiAccountAccess = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (id: string) => apiAccountAccess(id) }));
const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
vi.mock("@/lib/contacts/account-today", () => ({ accountToday: async () => "2026-10-13" }));
const db = { readGroup: vi.fn(), listRecordDocuments: vi.fn(), listPeopleNames: vi.fn(), serviceDb: vi.fn(() => { throw new Error("never"); }) };
vi.mock("@bis/db", () => db);
const { GET } = await import("./route");

const ACC = "44444444-4444-4444-8444-444444444444";
const G = "22222222-2222-4222-8222-222222222222";
const row = (over: Record<string, unknown> = {}) => ({
  id: "d1", account_id: ACC, contact_id: null, client_group_id: G, title: "Lease", category: "contract", expires_on: null,
  owners_only: false, source: "camera", current_version_id: "v1", created_by: "user_ana", created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z", deleted_at: null, deleted_by: null,
  version: { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "image/jpeg", original_name: "x.jpg", status: "ready", created_at: "x" },
  ...over,
});
const call = (id = G) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: ACC, groupId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false });
  db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Casa", billingAddress: null });
  db.listRecordDocuments.mockResolvedValue({ live: [row()], trashed: [], liveMore: false, trashedMore: false });
  db.listPeopleNames.mockResolvedValue({ user_ana: "Ana" });
});

describe("the Documents card's read for a group", () => {
  it("reads on the request client, names the author without sending their Clerk id (mutation: send created_by -> FAILS)", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(db.listRecordDocuments).toHaveBeenCalledWith(REQUEST, ACC, { kind: "group", id: G });
    expect(body.live[0]).toEqual({
      id: "d1", title: "Lease", category: "contract", expiresOn: null, ownersOnly: false, source: "camera",
      addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", deletedAt: null,
      version: { id: "v1", contentType: "image/jpeg", bytes: 1200 },
    });
    expect(JSON.stringify(body)).not.toContain("user_ana");
    expect(body).toMatchObject({ today: "2026-10-13", record: { kind: "group", id: G, groupKind: "household" }, capped: false });
  });
  it("the reader's own file says you; an unreadable name is null, the card's 'Someone on the team' (mutation: name the viewer from names -> FAILS)", async () => {
    db.listRecordDocuments.mockResolvedValue({ live: [row({ created_by: "user_me" }), row({ id: "d2", created_by: "user_gone" })], trashed: [], liveMore: false, trashedMore: true });
    db.listPeopleNames.mockResolvedValue({ user_ana: "Ana", user_me: "Me Name" });
    const body = await (await call()).json();
    expect(body.live.map((d: { addedBy: unknown }) => d.addedBy)).toEqual([{ you: true, name: null }, { you: false, name: null }]);
    expect(body.capped).toBe(true);
  });
  it("404 for no access, a malformed id or a group the caller cannot see; never lists (mutation: prove the group with getContact -> FAILS)", async () => {
    db.readGroup.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(404);
    apiAccountAccess.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(db.listRecordDocuments).not.toHaveBeenCalled();
  });
  it("a read failure is a 500 (the card's error state), never a partial body", async () => {
    db.listRecordDocuments.mockRejectedValue(new Error("down"));
    expect((await call()).status).toBe(500);
  });
});
