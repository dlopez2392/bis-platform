import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { tokenHash } from "@/lib/document-requests/token";

/**
 * Share links, the staff side (spec 4.1, E3; rulings O2, R-V). Every action proves the document on the
 * REQUEST client before any service write; the shared version is computed on the server by
 * documentView's rule (the REAL shareableVersion runs here), never taken from the browser.
 */
type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const STAFF: Access = { userId: "u_ana", isAgency: false, role: "staff", canManage: false };
const OWNER: Access = { userId: "u_ana", isAgency: false, role: "owner", canManage: true };
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
const REQUEST = { tag: "request" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const SERVICE = { tag: "service" };
const db = {
  getDocument: vi.fn(), listReadyVersionScans: vi.fn(), createDocumentShare: vi.fn(), revokeDocumentShares: vi.fn(), restoreDocumentShares: vi.fn(),
};
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, serviceDb: () => SERVICE, ...db };
});
const hdrs: { value: Headers } = { value: new Headers() };
vi.mock("next/headers", () => ({ headers: async () => hdrs.value }));
const TOKEN = "T".repeat(43);
vi.mock("@/lib/document-shares/share-token", () => ({
  newShareToken: () => TOKEN, shareUrl: (o: string, t: string) => `${o}/s/${t}`,
}));
const A = await import("./document-shares-actions");

const ACC = "44444444-4444-4444-8444-444444444444";
/** Letters in it, so the lowercasing case can fail (an all-digit uuid upper-cases to itself). */
const DOC = "abcdef22-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333331";
const V3 = "33333333-3333-4333-8333-333333333333";
const S1 = "abcdef55-5555-4555-8555-555555555551";
const REVOKED_AT = "2026-10-18T12:00:00.123456+00:00";
const doc = (over: Record<string, unknown> = {}) => ({
  id: DOC, account_id: ACC, contact_id: "11111111-1111-4111-8111-111111111111", client_group_id: null, title: "Seguro 2026",
  category: "insurance", expires_on: null, owners_only: false, source: "upload", current_version_id: V3, created_by: "u_bo",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, deleted_by: null, ...over,
});
const scan = (id: string, s: string, at: string) => ({ id, scan_status: s, created_at: at });
const SHARE_ROW = { id: S1 };
const writes = () => [db.createDocumentShare, db.revokeDocumentShares, db.restoreDocumentShares].flatMap((f) => f.mock.calls);

let errSpy: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  requireAccountAccess.mockReset();
  requireAccountAccess.mockResolvedValue(STAFF);
  vi.stubEnv("APP_ORIGIN", "");
  hdrs.value = new Headers({ host: "app.example.com", "x-forwarded-proto": "https" });
  db.getDocument.mockResolvedValue(doc());
  db.listReadyVersionScans.mockResolvedValue([scan(V3, "clean", "2026-10-02T00:00:00Z"), scan(V1, "clean", "2026-10-01T00:00:00Z")]);
  db.createDocumentShare.mockResolvedValue({ status: "ok", share: SHARE_ROW });
  db.revokeDocumentShares.mockResolvedValue({ ids: [S1], revokedAt: REVOKED_AT });
  db.restoreDocumentShares.mockResolvedValue({ status: "restored", count: 1 });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errSpy.mockRestore();
});

describe("createDocumentShareAction: Copy share link (spec 4.1)", () => {
  it("proves the file on the REQUEST client, then stores only the token's hash on the SERVICE client, and answers the link (mutations: write on the request client; write before the read; store the token -> FAILS)", async () => {
    expect(await A.createDocumentShareAction(ACC, DOC)).toEqual({ ok: true, url: `https://app.example.com/s/${TOKEN}` });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, DOC);
    expect(db.listReadyVersionScans).toHaveBeenCalledWith(REQUEST, ACC, DOC);
    expect(db.createDocumentShare.mock.calls).toEqual([[SERVICE, {
      accountId: ACC, documentId: DOC, versionId: V3, tokenHash: tokenHash(TOKEN), createdBy: "u_ana", ownersOnly: false, now: expect.any(Date),
    }]]);
    expect(JSON.stringify(db.createDocumentShare.mock.calls[0]![1])).not.toContain(TOKEN);
    expect(db.getDocument.mock.invocationCallOrder[0]!).toBeLessThan(db.createDocumentShare.mock.invocationCallOrder[0]!);
    expect(db.listReadyVersionScans.mock.invocationCallOrder[0]!).toBeLessThan(db.createDocumentShare.mock.invocationCallOrder[0]!);
  });
  it("lowercases the browser's id before every read and write (mutation: pass it through -> FAILS)", async () => {
    await A.createDocumentShareAction(ACC, DOC.toUpperCase());
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, DOC);
    expect(db.createDocumentShare.mock.calls[0]![1]).toMatchObject({ documentId: DOC });
  });
  it.each([
    ["the current version infected, an older one clean", "infected"],
    ["the current version still being checked, an older one clean", "pending"],
  ])("ruling R-V: %s shares the OLDER clean version, the one the reader sees (mutations: share current_version_id; refuse whenever the current one is not clean -> FAILS)", async (_l, current) => {
    db.listReadyVersionScans.mockResolvedValue([scan(V3, current, "2026-10-02T00:00:00Z"), scan(V1, "clean", "2026-10-01T00:00:00Z")]);
    expect(await A.createDocumentShareAction(ACC, DOC)).toMatchObject({ ok: true });
    expect(db.createDocumentShare.mock.calls[0]![1]).toMatchObject({ versionId: V1 });
  });
  it.each([
    ["a malformed id", () => A.createDocumentShareAction(ACC, "nope"), () => {}, "documents.share.refused"],
    ["a file the caller cannot see", () => A.createDocumentShareAction(ACC, DOC), () => db.getDocument.mockResolvedValue(null), "documents.share.refused"],
    ["a file in the trash", () => A.createDocumentShareAction(ACC, DOC), () => db.getDocument.mockResolvedValue(doc({ deleted_at: "2026-10-17T00:00:00Z", deleted_by: "u_bo" })), "documents.error.trashed"],
    ["no ready version", () => A.createDocumentShareAction(ACC, DOC), () => db.listReadyVersionScans.mockResolvedValue([]), "documents.error.scanning"],
    ["only a version still being checked", () => A.createDocumentShareAction(ACC, DOC), () => db.listReadyVersionScans.mockResolvedValue([scan(V3, "pending", "2026-10-02T00:00:00Z")]), "documents.error.scanning"],
    ["only an infected version", () => A.createDocumentShareAction(ACC, DOC), () => db.listReadyVersionScans.mockResolvedValue([scan(V3, "infected", "2026-10-02T00:00:00Z")]), "documents.error.removed"],
    ["only an unscannable version", () => A.createDocumentShareAction(ACC, DOC), () => db.listReadyVersionScans.mockResolvedValue([scan(V3, "unscannable", "2026-10-02T00:00:00Z")]), "documents.error.removed"],
    ["an Owners-only file, for Staff", () => A.createDocumentShareAction(ACC, DOC), () => db.getDocument.mockResolvedValue(doc({ owners_only: true })), "documents.share.ownersOnlyRole"],
  ] as const)("refuses %s with its own words and writes nothing (mutation: drop that check -> FAILS)", async (_l, run, arrange, error) => {
    arrange();
    expect(await run()).toEqual({ ok: false, error });
    expect(writes()).toEqual([]);
  });
  it("an Owner shares an Owners-only file, and the write carries the Owners-only value the read saw (E3; mutation: pass false always -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(doc({ owners_only: true }));
    expect(await A.createDocumentShareAction(ACC, DOC)).toMatchObject({ ok: true });
    expect(db.createDocumentShare.mock.calls[0]![1]).toMatchObject({ ownersOnly: true });
  });
  it("a file that changed between the read and the write (\"changed\") is refused, and no link is answered (mutation: answer the url anyway -> FAILS)", async () => {
    db.createDocumentShare.mockResolvedValue({ status: "changed" });
    expect(await A.createDocumentShareAction(ACC, DOC)).toEqual({ ok: false, error: "documents.share.refused" });
  });
  it("with no origin to build the link on, it fails and stores no share (mutation: write first -> FAILS)", async () => {
    hdrs.value = new Headers();
    expect(await A.createDocumentShareAction(ACC, DOC)).toEqual({ ok: false, error: "documents.share.failed" });
    expect(writes()).toEqual([]);
  });
  it("a failed write answers failed and logs the account and the document, never the token or the link (mutations: log the token or the url -> FAILS)", async () => {
    db.createDocumentShare.mockRejectedValue(new Error("boom"));
    expect(await A.createDocumentShareAction(ACC, DOC)).toEqual({ ok: false, error: "documents.share.failed" });
    const lines = errSpy.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines.filter((l) => l.includes(ACC) && l.includes(DOC) && l.includes("boom"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes(TOKEN) || l.includes("/s/"))).toEqual([]);
  });
  it("a successful create logs nothing that carries the token or the link, on ANY console channel (final review minor 2; mutation: console.info the token after minting it -> FAILS)", async () => {
    const others = (["log", "info", "warn", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    try {
      expect(await A.createDocumentShareAction(ACC, DOC)).toEqual({ ok: true, url: `https://app.example.com/s/${TOKEN}` });
      const lines = [errSpy, ...others].flatMap((spy) => spy.mock.calls.map((c: unknown[]) => c.map(String).join(" ")));
      expect(lines.filter((l) => l.includes(TOKEN) || l.includes("/s/"))).toEqual([]);
    } finally {
      for (const spy of others) spy.mockRestore();
    }
  });
});

describe("stopSharingAction: Stop sharing (spec 4.1, rule 6)", () => {
  it("proves on the request client, then stops every live link on the service client, and answers what it stopped plus the Owners-only value it read (mutation: skip the proof -> FAILS)", async () => {
    expect(await A.stopSharingAction(ACC, DOC)).toEqual({ ok: true, ids: [S1], revokedAt: REVOKED_AT, ownersOnly: false });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, DOC);
    expect(db.revokeDocumentShares.mock.calls).toEqual([[SERVICE, ACC, DOC, "u_ana", expect.any(Date)]]);
    expect(db.getDocument.mock.invocationCallOrder[0]!).toBeLessThan(db.revokeDocumentShares.mock.invocationCallOrder[0]!);
  });
  it("nothing live is 'no link to stop'", async () => {
    db.revokeDocumentShares.mockResolvedValue(null);
    expect(await A.stopSharingAction(ACC, DOC)).toEqual({ ok: false, error: "documents.share.notShared" });
  });
  it.each([
    ["a malformed id", "nope", () => {}, "documents.share.refused"],
    ["a file the caller cannot see", DOC, () => db.getDocument.mockResolvedValue(null), "documents.share.refused"],
    ["an Owners-only file, for Staff", DOC, () => db.getDocument.mockResolvedValue(doc({ owners_only: true })), "documents.share.ownersOnlyRole"],
  ] as const)("refuses %s and writes nothing (mutation: drop that check -> FAILS)", async (_l, id, arrange, error) => {
    arrange();
    expect(await A.stopSharingAction(ACC, id)).toEqual({ ok: false, error });
    expect(writes()).toEqual([]);
  });
  it("an Owner stops an Owners-only file's links, and the Undo payload says Owners only", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(doc({ owners_only: true }));
    expect(await A.stopSharingAction(ACC, DOC)).toEqual({ ok: true, ids: [S1], revokedAt: REVOKED_AT, ownersOnly: true });
  });
  it("a failed write answers failed, logged by account and document", async () => {
    db.revokeDocumentShares.mockRejectedValue(new Error("boom"));
    expect(await A.stopSharingAction(ACC, DOC)).toEqual({ ok: false, error: "documents.error.failed" });
    expect(errSpy.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.includes(ACC) && l.includes(DOC))).toHaveLength(1);
  });
});

describe("undoStopSharingAction: Stop sharing's Undo (rule 6)", () => {
  const undo = (ids: unknown = [S1.toUpperCase()], revokedAt: unknown = REVOKED_AT, ownersOnly: unknown = false, id = DOC) =>
    A.undoStopSharingAction(ACC, id, ids, revokedAt, ownersOnly);
  it("proves on the request client, then restores exactly those links on the service client (mutation: skip the proof -> FAILS)", async () => {
    expect(await undo()).toEqual({ ok: true });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, DOC);
    expect(db.restoreDocumentShares.mock.calls).toEqual([[SERVICE, {
      accountId: ACC, documentId: DOC, ids: [S1], revokedAt: REVOKED_AT, actorId: "u_ana", ownersOnly: false, now: expect.any(Date),
    }]]);
    expect(db.getDocument.mock.invocationCallOrder[0]!).toBeLessThan(db.restoreDocumentShares.mock.invocationCallOrder[0]!);
  });
  it.each([
    ["nothing restored (every link expired)", { status: "restored", count: 0 }],
    ["the file changed (Owners only, or the trash)", { status: "changed" }],
  ])("%s answers 'that link has already ended' (mutation: answer ok -> FAILS)", async (_l, answer) => {
    db.restoreDocumentShares.mockResolvedValue(answer);
    expect(await undo()).toEqual({ ok: false, error: "documents.share.ended" });
  });
  it.each([
    ["ids not an array", "x", REVOKED_AT, false],
    ["no ids", [], REVOKED_AT, false],
    ["51 ids", Array.from({ length: 51 }, () => S1), REVOKED_AT, false],
    ["a non-uuid id", [S1, "nope"], REVOKED_AT, false],
    ["a revokedAt that is not an instant", [S1], "yesterday", false],
    ["a revokedAt that is not a string", [S1], 12, false],
    ["an Owners-only value that is not a boolean", [S1], REVOKED_AT, "false"],
  ] as const)("a crafted payload (%s) is refused before any read (mutations: accept 51 ids; skip the shape check -> FAILS)", async (_l, ids, at, oo) => {
    expect(await undo(ids, at, oo)).toEqual({ ok: false, error: "documents.share.refused" });
    expect(db.getDocument).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
  it("50 ids is the most it takes (the bound is 50, not 49)", async () => {
    expect(await undo(Array.from({ length: 50 }, () => S1))).toEqual({ ok: true });
  });
  it("Staff sending a forged Owners-only value for an Owners-only file is stopped by the action's OWN read, before any write (mutation: trust the payload, skip the role check -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(doc({ owners_only: true }));
    expect(await undo([S1], REVOKED_AT, true)).toEqual({ ok: false, error: "documents.share.ownersOnlyRole" });
    expect(await undo([S1], REVOKED_AT, false)).toEqual({ ok: false, error: "documents.share.ownersOnlyRole" });
    expect(writes()).toEqual([]);
  });
  it("a payload whose Owners-only value is not what the file holds now is refused with no write (the file changed since the stop; mutation: pass the payload through -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(doc({ owners_only: true }));
    expect(await undo([S1], REVOKED_AT, false)).toEqual({ ok: false, error: "documents.share.ended" });
    expect(writes()).toEqual([]);
    expect(await undo([S1], REVOKED_AT, true)).toEqual({ ok: true });
    expect(db.restoreDocumentShares.mock.calls[0]![1]).toMatchObject({ ownersOnly: true });
  });
  it("orchestrator ruling M1: an Owner who stops a TEAM file's links, then switches it to Owners only, gets nothing back from an Undo claiming Owners only (the breaking sequence; mutation: drop the changed-since-the-stop check -> Staff's links come back -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    const STOP_AT = "2026-10-18T12:00:00.000Z";
    db.revokeDocumentShares.mockResolvedValue({ ids: [S1], revokedAt: STOP_AT });
    // 1. Stop sharing on a team file: the payload says ownersOnly false.
    const stopped = await A.stopSharingAction(ACC, DOC);
    expect(stopped).toEqual({ ok: true, ids: [S1], revokedAt: STOP_AT, ownersOnly: false });
    // 2. The Owner switches the file to Owners only AFTER the stop (setDocumentOwnersOnly stamps updated_at).
    db.getDocument.mockResolvedValue(doc({ owners_only: true, updated_at: "2026-10-18T12:00:05.000Z" }));
    // 3. The Undo, posted with the payload's value changed to true, so it matches the file.
    expect(await undo([S1], STOP_AT, true)).toEqual({ ok: false, error: "documents.share.ended" });
    expect(db.restoreDocumentShares).not.toHaveBeenCalled();
  });
  it("orchestrator ruling M1: a file that was ALREADY Owners only when an Owner stopped its links (unchanged since) still undoes (mutation: refuse every Owners-only undo -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(doc({ owners_only: true, updated_at: "2026-10-18T11:59:59.000Z" }));
    expect(await undo([S1], "2026-10-18T12:00:00.000Z", true)).toEqual({ ok: true });
    expect(db.restoreDocumentShares.mock.calls[0]![1]).toMatchObject({ ownersOnly: true });
  });
  it("a file the caller cannot see is refused with no write", async () => {
    db.getDocument.mockResolvedValue(null);
    expect(await undo()).toEqual({ ok: false, error: "documents.share.refused" });
    expect(writes()).toEqual([]);
  });
  it("a failed write answers failed", async () => {
    db.restoreDocumentShares.mockRejectedValue(new Error("boom"));
    expect(await undo()).toEqual({ ok: false, error: "documents.error.failed" });
  });
});
