import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const apiAccountAccess = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (id: string) => apiAccountAccess(id) }));
// The account row the documents clock reads on the SAME request client (its zone decides today and each added day).
type ZoneAnswer = { data: { timezone: string } | null; error: { message: string } | null };
const zoneRead = vi.fn<(...read: string[]) => Promise<ZoneAnswer>>(async () => ({ data: { timezone: "America/Chicago" }, error: null }));
const REQUEST = { tag: "request-db", from: (t: string) => ({ select: (c: string) => ({ eq: (k: string, v: string) => ({ maybeSingle: () => zoneRead(t, c, k, v) }) }) }) };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const db = { readGroup: vi.fn(), listRecordDocuments: vi.fn(), listPeopleNames: vi.fn(), serviceDb: vi.fn(() => { throw new Error("never"); }) };
vi.mock("@bis/db", () => db);
// The real zone rule needs the agency fallback (serviceDb); here the stored zone, or UTC when there is none.
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T13:00:00.000Z"));
  apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false });
  db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Casa", billingAddress: null });
  db.listRecordDocuments.mockResolvedValue({ live: [row()], trashed: [], liveMore: false, trashedMore: false });
  db.listPeopleNames.mockResolvedValue({ user_ana: "Ana" });
});

afterEach(() => vi.useRealTimers());

describe("the Documents card's read for a group", () => {
  it("reads on the request client, names the author without sending their Clerk id (mutation: send created_by -> FAILS)", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(db.listRecordDocuments).toHaveBeenCalledWith(REQUEST, ACC, { kind: "group", id: G });
    expect(body.live[0]).toEqual({
      id: "d1", title: "Lease", category: "contract", expiresOn: null, ownersOnly: false, source: "camera",
      addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
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
  it("each file's added day and today are the ACCOUNT's days: an evening upload is the day before, in the account's zone (mutation: addedOn from the UTC date -> FAILS)", async () => {
    // 21:30 on the 12th in Chicago is 02:30Z on the 13th; the server's clock reads 08:00 on the 13th there.
    db.listRecordDocuments.mockResolvedValue({ live: [row({ created_at: "2026-10-13T02:30:00Z" })], trashed: [row({ id: "t1", created_at: "2026-10-13T02:30:00Z", deleted_at: "2026-10-13T03:00:00Z" })], liveMore: false, trashedMore: false });
    const body = await (await call()).json();
    expect(zoneRead).toHaveBeenCalledWith("accounts", "timezone", "id", ACC);
    expect(body.today).toBe("2026-10-13");
    expect(body.live[0].addedOn).toBe("2026-10-12");
    expect(body.trashed[0].addedOn).toBe("2026-10-12");
  });
  it("an unreadable zone still answers (the fallback zone), never a 500 (mutation: throw on the zone read error -> FAILS)", async () => {
    zoneRead.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const res = await call();
    expect(res.status).toBe(200);
    // The fallback zone here is UTC: midnight UTC on the 1st is the 1st (in Chicago it would be Sept 30).
    expect((await res.json()).live[0].addedOn).toBe("2026-10-01");
  });
  it("a read failure is a 500 (the card's error state), never a partial body", async () => {
    db.listRecordDocuments.mockRejectedValue(new Error("down"));
    expect((await call()).status).toBe(500);
  });
});
