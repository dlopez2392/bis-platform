import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const apiAccountAccess = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (id: string) => apiAccountAccess(id) }));
// The account row the documents clock reads on the SAME request client (its zone decides today and each added day).
type ZoneAnswer = { data: { timezone: string } | null; error: { message: string } | null };
const zoneRead = vi.fn<(...read: string[]) => Promise<ZoneAnswer>>(async () => ({ data: { timezone: "America/Chicago" }, error: null }));
const REQUEST = { tag: "request-db", from: (t: string) => ({ select: (c: string) => ({ eq: (k: string, v: string) => ({ maybeSingle: () => zoneRead(t, c, k, v) }) }) }) };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const db = {
  getContact: vi.fn(), listRecordDocuments: vi.fn(), listPeopleNames: vi.fn(), documentSpaceUsed: vi.fn(),
  serviceDb: vi.fn(() => { throw new Error("never"); }), DOCUMENT_PURGING_MARK: "documents:purging",
};
vi.mock("@bis/db", () => db);
// The real zone rule needs the agency fallback (serviceDb); here the stored zone, or UTC when there is none.
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));
const { GET } = await import("./route");

const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const row = (over: Record<string, unknown> = {}) => ({
  id: "d1", account_id: ACC, contact_id: C, client_group_id: null, title: "Lease", category: "contract", expires_on: null,
  owners_only: false, source: "camera", current_version_id: "v1", created_by: "user_ana", created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z", deleted_at: null, deleted_by: null,
  version: { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "image/jpeg", original_name: "x.jpg", status: "ready", created_at: "x", scan_status: "clean", scan_signature: null },
  versions: [
    { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "image/jpeg", original_name: "x.jpg", status: "ready", created_at: "2026-10-01T00:00:00Z", scan_status: "clean", scan_signature: null },
    { id: "v0", document_id: "d1", account_id: ACC, storage_path: "q", bytes: 800, content_type: "application/pdf", original_name: "x.pdf", status: "ready", created_at: "2026-09-20T15:00:00Z", scan_status: "clean", scan_signature: null },
  ],
  ...over,
});
const call = (id = C) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: ACC, contactId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T13:00:00.000Z"));
  apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false });
  db.getContact.mockResolvedValue({ id: C });
  db.listRecordDocuments.mockResolvedValue({ live: [row()], trashed: [], liveMore: false, trashedMore: false });
  db.listPeopleNames.mockResolvedValue({ user_ana: "Ana" });
  db.documentSpaceUsed.mockResolvedValue(4_500_000_000);
});

afterEach(() => vi.useRealTimers());

describe("the Documents card's read for a contact", () => {
  it("reads on the request client, names the author without sending their Clerk id (mutation: send created_by -> FAILS)", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(db.listRecordDocuments).toHaveBeenCalledWith(REQUEST, ACC, { kind: "contact", id: C });
    expect(body.live[0]).toEqual({
      id: "d1", title: "Lease", category: "contract", expiresOn: null, ownersOnly: false, source: "camera",
      addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
      version: { id: "v1", contentType: "image/jpeg", bytes: 1200, scan: "clean", createdAt: "2026-10-01T00:00:00Z" },
      versions: [
        { id: "v1", contentType: "image/jpeg", bytes: 1200, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", scan: "clean" },
        { id: "v0", contentType: "application/pdf", bytes: 800, createdAt: "2026-09-20T15:00:00Z", addedOn: "2026-09-20", scan: "clean" },
      ],
      purging: false,
    });
    expect(JSON.stringify(body)).not.toContain("user_ana");
    expect(body).toMatchObject({ today: "2026-10-13", record: { kind: "contact", id: C }, capped: false });
  });
  it("the reader's own file says you; an unreadable name is null, the card's 'Someone on the team' (mutation: name the viewer from names -> FAILS)", async () => {
    db.listRecordDocuments.mockResolvedValue({ live: [row({ created_by: "user_me" }), row({ id: "d2", created_by: "user_gone" })], trashed: [], liveMore: false, trashedMore: true });
    db.listPeopleNames.mockResolvedValue({ user_ana: "Ana", user_me: "Me Name" });
    const body = await (await call()).json();
    expect(body.live.map((d: { addedBy: unknown }) => d.addedBy)).toEqual([{ you: true, name: null }, { you: false, name: null }]);
    expect(body.capped).toBe(true);
  });
  it("404 for no access, a malformed id or a contact the caller cannot see; never lists (mutation: list before getContact -> FAILS)", async () => {
    db.getContact.mockResolvedValue(null);
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
  it("a trashed file whose Delete forever began is 'purging'; any other trashed file is not, and the marker never travels (review m1; mutation: purging always false -> FAILS)", async () => {
    db.listRecordDocuments.mockResolvedValue({ live: [row()], trashed: [
      row({ id: "t1", deleted_at: "2026-10-13T03:00:00Z", deleted_by: "documents:purging" }),
      row({ id: "t2", deleted_at: "2026-10-13T03:00:00Z", deleted_by: "user_ana" })], liveMore: false, trashedMore: false });
    const body = await (await call()).json();
    expect([body.live[0].purging, body.trashed[0].purging, body.trashed[1].purging]).toEqual([false, true, false]);
    expect(JSON.stringify(body)).not.toContain("documents:purging");
  });
  it("reports the account's usage on the REQUEST client, against the 5 GB quota (mutation: read it on serviceDb() -> the mock throws -> FAILS)", async () => {
    const body = await (await call()).json();
    expect(db.documentSpaceUsed).toHaveBeenCalledWith(REQUEST, ACC);
    expect(body.space).toEqual({ used: 4_500_000_000, quota: 5_368_709_120 });
  });
  it("a failed usage read is omitted, never a 500 and never zero: the card still loads (mutation: let the error reach the route's catch -> 500 -> FAILS)", async () => {
    db.documentSpaceUsed.mockRejectedValue(new Error("42501"));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).space).toBeNull();
  });
  it("shows the newest CLEAN version while a newer one is still Checking, and lists both with their states (plan deviation 1; mutation: show d.version, the newest ready -> FAILS)", async () => {
    const v2 = { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "image/jpeg", original_name: "x.jpg", status: "ready", created_at: "2026-10-01T00:00:00Z", scan_status: "pending" };
    const v1 = { id: "v0", document_id: "d1", account_id: ACC, storage_path: "q", bytes: 800, content_type: "application/pdf", original_name: "x.pdf", status: "ready", created_at: "2026-09-20T15:00:00Z", scan_status: "clean" };
    db.listRecordDocuments.mockResolvedValue({ live: [row({ version: v2, versions: [v2, v1] })], trashed: [], liveMore: false, trashedMore: false });
    const body = await (await call()).json();
    expect(body.live[0].version).toEqual({ id: "v0", contentType: "application/pdf", bytes: 800, scan: "clean", createdAt: "2026-09-20T15:00:00Z" });
    expect(body.live[0].versions.map((v: { id: string; scan: string }) => [v.id, v.scan])).toEqual([["v1", "pending"], ["v0", "clean"]]);
  });
  it("a password-protected file reads 'locked', a limit 'unscannable', and clamd's name never reaches the JSON (owner ruling 2026-10-15; mutation: send scan_status through unmapped -> FAILS; send the signature -> FAILS)", async () => {
    const locked = { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "application/pdf", original_name: "x.pdf", status: "ready", created_at: "2026-10-01T00:00:00Z", scan_status: "unscannable", scan_signature: "Heuristics.Encrypted.PDF" };
    const limit = { ...locked, id: "v9", scan_signature: "Heuristics.Limits.Exceeded.MaxFileSize" };
    db.listRecordDocuments.mockResolvedValue({ live: [row({ version: locked, versions: [locked] }), row({ id: "d2", version: limit, versions: [limit] })], trashed: [], liveMore: false, trashedMore: false });
    const res = await call();
    const text = await res.text();
    expect(text).not.toContain("Heuristics");
    const body = JSON.parse(text) as { live: { version: { scan: string } }[] };
    expect(body.live.map((d) => d.version.scan)).toEqual(["locked", "unscannable"]);
  });
});
