import { describe, it, expect, vi, beforeEach } from "vitest";

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));

const storage = {
  createSignedUploadUrl: vi.fn(), download: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn(),
};
const SERVICE = { tag: "service-db", storage: { from: vi.fn(() => storage) } };
const db = {
  getContact: vi.fn(), readGroup: vi.fn(), getDocument: vi.fn(), getDocumentVersion: vi.fn(), getUploadingVersion: vi.fn(),
  createDocument: vi.fn(), reserveDocumentVersion: vi.fn(), markDocumentVersionReady: vi.fn(), discardDocumentUpload: vi.fn(),
  updateDocumentField: vi.fn(), setDocumentOwnersOnly: vi.fn(), trashDocument: vi.fn(), restoreDocument: vi.fn(),
  listDocumentVersionStates: vi.fn(), claimDocumentForPurge: vi.fn(), deletePurgedDocument: vi.fn(), signedDocumentReadUrl: vi.fn(),
  serviceDb: vi.fn(() => SERVICE),
};
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...db, DOCUMENT_BUCKET: real.DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES: real.DOCUMENT_MAX_BYTES,
    isDocumentCategory: real.isDocumentCategory, isDocumentContentType: real.isDocumentContentType,
    DOCUMENT_PURGING_MARK: real.DOCUMENT_PURGING_MARK };
});
const scanVersion = vi.fn();
vi.mock("@/lib/documents/scan-version", () => ({ scanVersion: (...a: unknown[]) => scanVersion(...a) }));
const A = await import("./documents-actions");

const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const D = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";
const OWNER: Access = { userId: "user_owner", isAgency: false, role: "owner", canManage: true };
const STAFF: Access = { userId: "user_staff", isAgency: false, role: "staff", canManage: false };
const PDF = new TextEncoder().encode("%PDF-1.7 hello");
/** An EXE's leading bytes at exactly the reserved size (raw bytes: a "\u0090" string encodes to TWO bytes in UTF-8). */
const EXE = (() => { const b = new Uint8Array(PDF.length).fill(0x20); b.set([0x4d, 0x5a, 0x90]); return b; })();
const DOC = { id: D, account_id: ACC, contact_id: C, client_group_id: null, title: "Lease", category: "contract", expires_on: null,
  owners_only: false, source: "upload", current_version_id: null, created_by: "user_owner", created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z", deleted_at: null, deleted_by: null };
const input = (over: Partial<Parameters<typeof A.startDocumentUploadAction>[1]> = {}) => ({
  record: { kind: "contact" as const, id: C }, name: "Lease.pdf", title: "Lease", size: 1200, contentType: "application/pdf",
  category: "contract", expiresOn: null, ownersOnly: false, source: "upload" as const, ...over,
});
const readyVersion = (contentType: string) => ({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: 1, status: "ready",
  original_name: null, created_at: "x", content_type: contentType, scan_status: "clean" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAccountAccess.mockResolvedValue(OWNER);
  db.getContact.mockResolvedValue({ id: C });
  db.createDocument.mockResolvedValue(D);
  db.reserveDocumentVersion.mockResolvedValue({ status: "ok", versionId: V, storagePath: `${ACC}/${D}/${V}` });
  storage.createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "https://x/upload?token=t", token: "t", path: "p" }, error: null });
  // clearAllMocks keeps a queued mockResolvedValueOnce: a case that stops early (or a mutation) would
  // hand its unread answer to the NEXT case's proof read. reset drops the queue.
  db.getDocument.mockReset();
  db.getDocument.mockResolvedValue(DOC);
  db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: `${ACC}/${D}/${V}`, bytes: PDF.length, content_type: "application/pdf", original_name: "Lease.pdf", status: "uploading", created_at: "x" });
  storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
  storage.remove.mockResolvedValue({ data: [], error: null });
  db.markDocumentVersionReady.mockResolvedValue(true);
  // The real discard is async: a bare vi.fn() would answer undefined, and cleanUp's .catch on it would throw.
  db.discardDocumentUpload.mockResolvedValue(undefined);
  scanVersion.mockReset();
  scanVersion.mockResolvedValue("clean");
});

describe("startDocumentUploadAction (spec 5.1)", () => {
  it("proves the record on the REQUEST client before any service write, and returns the signed upload URL (mutation: skip getContact -> FAILS)", async () => {
    expect(await A.startDocumentUploadAction(ACC, input())).toEqual({ ok: true, documentId: D, versionId: V, uploadUrl: "https://x/upload?token=t" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, ACC, C);
    expect(db.getContact.mock.invocationCallOrder[0]!).toBeLessThan(db.createDocument.mock.invocationCallOrder[0]!);
    expect(db.createDocument.mock.calls[0]![0]).toBe(SERVICE);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${ACC}/${D}/${V}`);
  });
  it("a record the caller cannot see is 'not found' and writes nothing (mutation: treat a null getContact as visible -> FAILS)", async () => {
    db.getContact.mockResolvedValue(null);
    expect(await A.startDocumentUploadAction(ACC, input())).toEqual({ ok: false, error: "documents.error.notFound" });
    expect(db.createDocument).not.toHaveBeenCalled();
  });
  it("a group record is proven with readGroup (mutation: prove every record with getContact -> FAILS)", async () => {
    db.readGroup.mockResolvedValue({ id: D, kind: "household", name: "Casa", billingAddress: null });
    await A.startDocumentUploadAction(ACC, input({ record: { kind: "group", id: D } }));
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, ACC, D);
    expect(db.getContact).not.toHaveBeenCalled();
  });
  it("Owners only from Staff is refused before any read (mutation: drop the canManage check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await A.startDocumentUploadAction(ACC, input({ ownersOnly: true }))).toEqual({ ok: false, error: "documents.error.ownersOnlyRole" });
    expect(db.createDocument).not.toHaveBeenCalled();
  });
  it.each([
    ["oversize (one byte over reads 25.1 MB, never \"25 MB\" beside a 25 MB limit; mutation: round to nearest -> FAILS)", input({ size: 26_214_401 }), { ok: false, error: "documents.error.tooLarge", params: { size: "25.1 MB" } }],
    ["a disallowed type", input({ name: "x.svg", contentType: "image/svg+xml" }), { ok: false, error: "documents.error.badType" }],
    ["an allowed type with a disallowed extension", input({ name: "x.exe" }), { ok: false, error: "documents.error.badType" }],
    ["an allowed extension with a disallowed type (mutation: drop isDocumentContentType; the svg case above cannot fail it, its extension is refused too)",
      input({ name: "x.pdf", contentType: "image/svg+xml" }), { ok: false, error: "documents.error.badType" }],
    ["an unknown category", input({ category: "receipt" }), { ok: false, error: "documents.error.refused" }],
    ["a bad expiry", input({ expiresOn: "2026-02-30" }), { ok: false, error: "documents.error.refused" }],
  ])("refuses %s without writing (mutation: drop that check -> FAILS)", async (_l, i, want) => {
    expect(await A.startDocumentUploadAction(ACC, i)).toEqual(want);
    expect(db.createDocument).not.toHaveBeenCalled();
  });
  it("quota full: the empty document is removed and the answer is the quota sentence (mutation: leave the document -> FAILS)", async () => {
    db.reserveDocumentVersion.mockResolvedValue({ status: "over_quota" });
    expect(await A.startDocumentUploadAction(ACC, input())).toEqual({ ok: false, error: "documents.error.quota" });
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, null);
  });
});

describe("finishDocumentUploadAction (spec 5.1, 5.2)", () => {
  it("checks the real bytes against the reserved size and the stored type, hashes them, and marks the version ready (mutation: skip the size comparison -> FAILS on the next case)", async () => {
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "clean" });
    const call = db.markDocumentVersionReady.mock.calls[0]![1] as { bytes: number; sha256: string; actorId: string; actorType: string };
    expect(call.bytes).toBe(PDF.length);
    expect(call.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
  });

  it("the staff finish marks the version ready as the caller's own id, as a USER, never the system (mutation: \"system\" on the staff call -> FAILS)", async () => {
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "clean" });
    expect(db.markDocumentVersionReady.mock.calls[0]![1]).toMatchObject({ actorId: "user_owner", actorType: "user" });
  });
  it.each([
    ["a stored size other than the reserved size (an understated size; mutation: drop the size comparison -> FAILS)",
      () => storage.download.mockResolvedValue({ data: new Blob([PDF, new Uint8Array(1)], { type: "application/pdf" }), error: null }), "documents.error.upload"],
    ["a type mismatch (an EXE named .pdf)", () => storage.download.mockResolvedValue({ data: new Blob([EXE], { type: "application/pdf" }), error: null }), "documents.error.badType"],
    ["a stored content type other than the declared one (mutation: drop the blob.type comparison -> FAILS)",
      () => storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "image/png" }), error: null }), "documents.error.badType"],
  ])("%s: the object, then the version and the never-ready document, are removed (mutation: skip the cleanup -> FAILS)", async (_l, arrange, error) => {
    arrange();
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error });
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/${V}`]);
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, V);
    expect(db.markDocumentVersionReady).not.toHaveBeenCalled();
  });
  it("a missing object leaves the rows uploading for the sweep: a PUT still in flight on the 2-hour URL would otherwise land with no row and never be swept (mutation: clean up the rows -> FAILS)", async () => {
    storage.download.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.upload" });
    expect(db.discardDocumentUpload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(db.markDocumentVersionReady).not.toHaveBeenCalled();
  });
  it("the stored type is compared as a media type: case and parameters do not refuse a real PDF (mutation: compare blob.type raw -> FAILS)", async () => {
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "Application/PDF; charset=binary" }), error: null });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "clean" });
  });
  it("the stored type's case is folded by the action itself, not only by Blob (mutation: drop the toLowerCase -> FAILS)", async () => {
    // A real Blob lowercases its own type, so the Blob case above cannot catch a missing toLowerCase.
    // A body whose type keeps its capitals can.
    storage.download.mockResolvedValue({ data: { type: "Application/PDF", arrayBuffer: async () => PDF.slice().buffer }, error: null });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "clean" });
  });
  it("a storage removal that fails leaves the rows for the sweep (plan review I3; mutation: discard the rows anyway -> FAILS)", async () => {
    storage.download.mockResolvedValue({ data: new Blob([PDF, new Uint8Array(1)], { type: "application/pdf" }), error: null });
    storage.remove.mockResolvedValue({ data: null, error: { message: "storage down" } });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.upload" });
    expect(db.discardDocumentUpload).not.toHaveBeenCalled();
  });
  it("a ready-mark the database refuses (size_mismatch, or a finish that lost a race) is refused and removes nothing: the version may be another finish's ready one (mutation: clean up on false -> FAILS)", async () => {
    db.markDocumentVersionReady.mockResolvedValue(false);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(db.discardDocumentUpload).not.toHaveBeenCalled();
  });
  it("no uploading row and no row at all: the derivable path is removed; a READY row is never touched (mutation: remove the path when a ready row exists -> FAILS)", async () => {
    db.getUploadingVersion.mockResolvedValue(null);
    db.getDocumentVersion.mockResolvedValue(null);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/${V}`]);
    expect(db.discardDocumentUpload).not.toHaveBeenCalled();   // mutation: discard the document here -> FAILS
    vi.clearAllMocks();
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue(null);
    db.getDocumentVersion.mockResolvedValue({ id: V, document_id: D, status: "ready" });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("a document the caller cannot see is refused before the service read (mutation: read the version first -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(null);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.getUploadingVersion).not.toHaveBeenCalled();
  });
});

describe("abandonDocumentUploadAction (spec 5.1)", () => {
  it("removes the reserved object, then the rows (mutation: skip the cleanup -> FAILS)", async () => {
    expect(await A.abandonDocumentUploadAction(ACC, D, V)).toEqual({ ok: true });
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/${V}`]);
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, V);
    expect(storage.remove.mock.invocationCallOrder[0]!).toBeLessThan(db.discardDocumentUpload.mock.invocationCallOrder[0]!);
  });
  it("a document the caller cannot see is refused and nothing is removed (mutation: skip the request-client read -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(null);
    expect(await A.abandonDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.getUploadingVersion).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("getDocumentUrlAction (spec 5.1)", () => {
  it("a version the reader cannot see is 'not found' (opening is not changing; RLS read on the request client) and nothing is minted (mutation: read the version on the service client, or answer refused -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(null);
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.fileNotFound" });
    expect(db.getDocumentVersion).toHaveBeenCalledWith(REQUEST, ACC, V);
    expect(db.signedDocumentReadUrl).not.toHaveBeenCalled();
  });
  it("mints 120 seconds; Word is always a download named after the title (mutation: mint Word inline -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: 1, status: "ready", original_name: null, created_at: "x", scan_status: "clean",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    db.signedDocumentReadUrl.mockResolvedValue({ status: "ok", url: "https://x/sign" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toMatchObject({ ok: true, url: "https://x/sign" });
    expect(db.signedDocumentReadUrl).toHaveBeenCalledWith(SERVICE, ACC, V, { seconds: 120, download: "Lease.docx" });
  });
  it("Excel is always a download too (mutation: OFFICE_TYPES without Excel -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    db.signedDocumentReadUrl.mockResolvedValue({ status: "ok", url: "https://x/sign" });
    await A.getDocumentUrlAction(ACC, V, "view");
    expect(db.signedDocumentReadUrl).toHaveBeenCalledWith(SERVICE, ACC, V, { seconds: 120, download: "Lease.xlsx" });
  });
  it("a PDF to view opens inline, and the document is proven on the request client too (mutation: always download -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/pdf"));
    db.signedDocumentReadUrl.mockResolvedValue({ status: "ok", url: "https://x/sign" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: true, url: "https://x/sign", contentType: "application/pdf" });
    expect(db.signedDocumentReadUrl).toHaveBeenCalledWith(SERVICE, ACC, V, { seconds: 120, download: undefined });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
  });
  it("a version whose document the reader cannot see is 'not found' and nothing is minted (mutation: skip the document read -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/pdf"));
    db.getDocument.mockResolvedValue(null);
    expect(await A.getDocumentUrlAction(ACC, V, "download")).toEqual({ ok: false, error: "documents.error.fileNotFound" });
    expect(db.signedDocumentReadUrl).not.toHaveBeenCalled();
  });
  it("a version still uploading is never minted (mutation: drop the ready check -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue({ ...readyVersion("application/pdf"), status: "uploading" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.fileNotFound" });
    expect(db.signedDocumentReadUrl).not.toHaveBeenCalled();
  });
});

describe("virus scanning in the actions (S-07 2a; spec 3.3, 3.4)", () => {
  it("the finish scans ONCE, after the version is ready, with its own path and no attempts, and answers the scan's outcome (mutations: scan before markDocumentVersionReady -> the order FAILS; drop the scan -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: `${ACC}/${D}/${V}`, bytes: PDF.length, content_type: "application/pdf", status: "uploading" });
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
    db.markDocumentVersionReady.mockResolvedValue(true);
    scanVersion.mockResolvedValue("infected");
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "infected" });
    expect(scanVersion).toHaveBeenCalledTimes(1);
    // Re-review N2a: the finish holds any countable error; only the pass spends (mutation: drop holdErrors -> FAILS).
    expect(scanVersion).toHaveBeenCalledWith(SERVICE, { accountId: ACC, versionId: V, storagePath: `${ACC}/${D}/${V}`, attempts: 0 }, undefined, { holdErrors: true });
    expect(db.markDocumentVersionReady.mock.invocationCallOrder[0]!).toBeLessThan(scanVersion.mock.invocationCallOrder[0]!);
  });

  it("a scan that throws never fails the upload: the file is stored and stays Checking (mutation: let the throw reach the catch -> documents.error.upload -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: PDF.length, content_type: "application/pdf", status: "uploading" });
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
    db.markDocumentVersionReady.mockResolvedValue(true);
    scanVersion.mockRejectedValue(new Error("storage down"));
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "pending" });
  });

  it("a refused finish never scans (mutation: scan before checking mark's answer -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: PDF.length, content_type: "application/pdf", status: "uploading" });
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
    db.markDocumentVersionReady.mockResolvedValue(false);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(scanVersion).not.toHaveBeenCalled();
  });

  it("the URL goes through the one gate on the SERVICE client after the request-client proof, and says why it refused (mutations: answer fileNotFound for pending -> FAILS; mint without the gate -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/pdf"));
    db.getDocument.mockResolvedValue(DOC);
    db.signedDocumentReadUrl.mockResolvedValueOnce({ status: "pending" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.scanning" });
    db.signedDocumentReadUrl.mockResolvedValueOnce({ status: "removed" });
    expect(await A.getDocumentUrlAction(ACC, V, "download")).toEqual({ ok: false, error: "documents.error.removed" });
    db.signedDocumentReadUrl.mockResolvedValueOnce({ status: "not_found" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.fileNotFound" });
    expect(db.getDocumentVersion).toHaveBeenCalledWith(REQUEST, ACC, V);
    expect(db.signedDocumentReadUrl.mock.calls.every((c) => c[0] === SERVICE)).toBe(true);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});

const LISTED = { ...DOC, current_version_id: "55555555-5555-4555-8555-555555555555" };
const TRASHED = { ...LISTED, deleted_at: "2026-10-13T15:00:00.123456+00:00", deleted_by: "user_owner" };
const vInput = (over: Partial<Parameters<typeof A.startDocumentVersionUploadAction>[2]> = {}) =>
  ({ name: "Lease v2.pdf", size: 1300, contentType: "application/pdf", ...over });

describe("startDocumentVersionUploadAction (spec 3.3, 4.1: Upload new version)", () => {
  beforeEach(() => { db.getDocument.mockResolvedValue(LISTED); });
  it("proves the document on the REQUEST client, then reserves a version of THAT document on the service client, and answers the signed URL (mutation: skip getDocument -> FAILS)", async () => {
    expect(await A.startDocumentVersionUploadAction(ACC, D.toUpperCase(), vInput()))
      .toEqual({ ok: true, documentId: D, versionId: V, uploadUrl: "https://x/upload?token=t" });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
    expect(db.getDocument.mock.invocationCallOrder[0]!).toBeLessThan(db.reserveDocumentVersion.mock.invocationCallOrder[0]!);
    expect(db.reserveDocumentVersion).toHaveBeenCalledWith(SERVICE, {
      accountId: ACC, documentId: D, bytes: 1300, contentType: "application/pdf", originalName: "Lease v2.pdf", uploadedBy: "user_owner" });
    expect(db.createDocument).not.toHaveBeenCalled();
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${ACC}/${D}/${V}`);
  });
  it("an id with hex letters, sent uppercased, is lowercased for the proof read, the reservation and the answer (review I1: D has no letters; mutation: use the raw input id -> FAILS)", async () => {
    const HEX = "abcdef12-3456-4789-8abc-def012345678";
    db.reserveDocumentVersion.mockResolvedValue({ status: "ok", versionId: V, storagePath: `${ACC}/${HEX}/${V}` });
    expect(await A.startDocumentVersionUploadAction(ACC, HEX.toUpperCase(), vInput()))
      .toEqual({ ok: true, documentId: HEX, versionId: V, uploadUrl: "https://x/upload?token=t" });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, HEX);
    expect(db.reserveDocumentVersion.mock.calls[0]![1]).toMatchObject({ documentId: HEX });
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${ACC}/${HEX}/${V}`);
  });
  it("a file the caller cannot see, or one never listed, is refused and nothing is reserved (mutations: treat null as visible; drop the current-version check -> FAILS)", async () => {
    db.getDocument.mockResolvedValueOnce(null);
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.refused" });
    db.getDocument.mockResolvedValueOnce(DOC);   // current_version_id null: its first upload is still in flight
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.reserveDocumentVersion).not.toHaveBeenCalled();
  });
  it("a document with no READY current version gets no new version: the first ready version is the oldest only because the app refuses here (0078 comment; mutation: drop the current-version check -> FAILS)", async () => {
    // current_version_id is non-null only on a ready version (0077's documents_current_is_ready trigger),
    // so null is exactly "no ready version yet". Visible, live, and nothing else wrong with it.
    db.getDocument.mockResolvedValue({ ...LISTED, current_version_id: null });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.reserveDocumentVersion).not.toHaveBeenCalled();
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("a file in the trash gets no new version (plan deviation 2; mutation: drop the trash check -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(TRASHED);
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.trashed" });
    expect(db.reserveDocumentVersion).not.toHaveBeenCalled();
  });
  it("too large and a disallowed type are refused before any read (mutation: read first -> FAILS on the call count)", async () => {
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput({ size: 26_214_401 })))
      .toEqual({ ok: false, error: "documents.error.tooLarge", params: { size: "25.1 MB" } });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput({ name: "x.exe" }))).toEqual({ ok: false, error: "documents.error.badType" });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput({ contentType: "image/svg+xml" }))).toEqual({ ok: false, error: "documents.error.badType" });
    expect(db.getDocument).not.toHaveBeenCalled();
  });
  it("quota full answers the quota sentence and never discards anything: the file and its versions stay (mutation: discard(…, null) on a refusal -> FAILS)", async () => {
    db.reserveDocumentVersion.mockResolvedValue({ status: "over_quota" });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.quota" });
    expect(db.discardDocumentUpload).not.toHaveBeenCalled();
  });
  it("no signed URL: the new reservation goes, by its own version id, and the answer is the upload failure (mutation: discard with null -> FAILS)", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.upload" });
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, V);
  });
});

describe("finishDocumentUploadAction refuses a file that went to the trash mid-upload (plan deviation 2)", () => {
  it("removes the object first, then the reservation, answers 'in the trash', and never marks it ready (mutation: drop the trash check -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(TRASHED);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.trashed" });
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/${V}`]);
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, V);
    expect(storage.remove.mock.invocationCallOrder[0]!).toBeLessThan(db.discardDocumentUpload.mock.invocationCallOrder[0]!);
    expect(storage.download).not.toHaveBeenCalled();
    expect(db.markDocumentVersionReady).not.toHaveBeenCalled();
  });
});

describe("purgeDocumentAction: Delete forever by the typed name (spec 4.4, 5.1; deviations 3, 4, 5, 8)", () => {
  const CLAIMED = "2026-10-14T09:00:00.5+00:00";
  beforeEach(() => {
    db.getDocument.mockResolvedValue(TRASHED);
    db.listDocumentVersionStates.mockResolvedValue([
      { storage_path: `${ACC}/${D}/v1`, status: "ready" }, { storage_path: `${ACC}/${D}/v2`, status: "ready" }]);
    db.claimDocumentForPurge.mockResolvedValue(CLAIMED);
    db.deletePurgedDocument.mockResolvedValue(true);
  });
  it("proves the file on the REQUEST client, then claims, removes EVERY version's object, then deletes the row, in that order (mutations: delete before remove; remove only the current path -> FAILS)", async () => {
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
    expect(db.listDocumentVersionStates).toHaveBeenCalledWith(SERVICE, ACC, D);
    expect(db.claimDocumentForPurge).toHaveBeenCalledWith(SERVICE, ACC, D, TRASHED.deleted_at);
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/v1`, `${ACC}/${D}/v2`]);
    expect(db.deletePurgedDocument).toHaveBeenCalledWith(SERVICE, ACC, TRASHED, CLAIMED, "user_owner");
    const order = [db.getDocument, db.claimDocumentForPurge, storage.remove, db.deletePurgedDocument].map((f) => f.mock.invocationCallOrder[0]!);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the typed name must match exactly: case and edge spaces count (deviation 8; mutation: compare trimmed or lowercased -> FAILS)", async () => {
    for (const typed of ["lease", "Lease ", " Lease", "LEASE", ""]) {
      expect(await A.purgeDocumentAction(ACC, D, typed), typed).toEqual({ ok: false, error: "documents.purge.mismatch" });
    }
    expect(db.listDocumentVersionStates).not.toHaveBeenCalled();
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
  });
  it("the visible form of the name confirms: a run of spaces, a non-breaking space, a decomposed accent; another letter refuses (Task 7 review I2; mutation: compare raw strings -> FAILS)", async () => {
    for (const [title, typed] of [["Lease  2026", "Lease 2026"], ["Lease\u00a02026", "Lease 2026"], ["Pen\u0303a", "Pe\u00f1a"]] as const) {
      db.getDocument.mockResolvedValue({ ...TRASHED, title });
      expect(await A.purgeDocumentAction(ACC, D, typed), JSON.stringify(title)).toEqual({ ok: true });
    }
    db.getDocument.mockResolvedValue({ ...TRASHED, title: "Pen\u0303a" });
    expect(await A.purgeDocumentAction(ACC, D, "Pena")).toEqual({ ok: false, error: "documents.purge.mismatch" });
  });
  it("only a file in the trash, and only one the caller can see (mutations: drop the trashed check; treat null as visible -> FAILS)", async () => {
    db.getDocument.mockResolvedValueOnce(LISTED);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.refused" });
    db.getDocument.mockResolvedValueOnce(null);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(await A.purgeDocumentAction(ACC, "not-a-uuid", "Lease")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("a version still uploading refuses the purge before anything changes (deviation 3; mutation: drop the in-flight check -> FAILS)", async () => {
    db.listDocumentVersionStates.mockResolvedValue([
      { storage_path: `${ACC}/${D}/v1`, status: "ready" }, { storage_path: `${ACC}/${D}/v2`, status: "uploading" }]);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeUploading" });
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("a lost claim (someone restored or changed it first) removes nothing (deviation 4; mutation: ignore a null claim -> FAILS)", async () => {
    db.claimDocumentForPurge.mockResolvedValue(null);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeChanged" });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(db.deletePurgedDocument).not.toHaveBeenCalled();
  });
  it("storage refusing the removal keeps the row: nothing is deleted, and the answer says try again (mutation: delete the row anyway -> FAILS)", async () => {
    storage.remove.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purge" });
    expect(db.deletePurgedDocument).not.toHaveBeenCalled();
  });
  it("a row that moved after its objects went is a failure, never a success (mutation: ignore deletePurgedDocument's false -> FAILS)", async () => {
    db.deletePurgedDocument.mockResolvedValue(false);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purge" });
  });
  it("a concurrent Delete forever that finished the file first is success, not 'changed' or 'try again': the file is gone, as asked (review; mutation: answer the delete's false without re-reading -> FAILS)", async () => {
    // The other purge re-claimed from our marker, removed the same objects and deleted the row:
    // our delete matches nothing, and the service re-read finds no row.
    db.getDocument.mockResolvedValueOnce(TRASHED).mockResolvedValueOnce(null);
    db.deletePurgedDocument.mockResolvedValue(false);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
    expect(db.getDocument.mock.calls[1]).toEqual([SERVICE, ACC, D]);
  });
  it("a claim lost because a concurrent Delete forever already deleted the row is success too (review; mutation: answer a null claim without re-reading -> FAILS)", async () => {
    db.getDocument.mockResolvedValueOnce(TRASHED).mockResolvedValueOnce(null);
    db.claimDocumentForPurge.mockResolvedValue(null);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
    expect(db.getDocument.mock.calls[1]).toEqual([SERVICE, ACC, D]);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(db.deletePurgedDocument).not.toHaveBeenCalled();
  });
  it("a lost claim whose row another Delete forever is mid-way through (the purging marker) is success: the file is being deleted (review M1; mutation: treat only a missing row as gone -> FAILS)", async () => {
    db.getDocument.mockResolvedValueOnce(TRASHED)
      .mockResolvedValueOnce({ ...TRASHED, deleted_at: "2026-10-14T09:00:01+00:00", deleted_by: "documents:purging" });
    db.claimDocumentForPurge.mockResolvedValue(null);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
    expect(db.getDocument.mock.calls[1]).toEqual([SERVICE, ACC, D]);
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("a delete that matched nothing because another Delete forever re-claimed the row (the purging marker) is success (review M1; mutation: treat only a missing row as gone -> FAILS)", async () => {
    db.getDocument.mockResolvedValueOnce(TRASHED)
      .mockResolvedValueOnce({ ...TRASHED, deleted_at: "2026-10-14T09:00:01+00:00", deleted_by: "documents:purging" });
    db.deletePurgedDocument.mockResolvedValue(false);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
    expect(db.getDocument.mock.calls[1]).toEqual([SERVICE, ACC, D]);
  });
  it("Staff (and a Technician) are refused before anything is read: Delete forever is an Owner's and the agency's (owner ruling R1, deviation 5; mutation: drop the canManage check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeRole" });
    requireAccountAccess.mockResolvedValue({ userId: "user_tech", isAgency: false, role: "technician", canManage: false });
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeRole" });
    expect(db.getDocument).not.toHaveBeenCalled();
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("the agency is allowed (canManage true without an account role) (mutation: require role === 'owner' -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue({ userId: "user_agency", isAgency: true, role: null, canManage: true });
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
  });
});

describe("inline edits and their compare-and-set Undo (spec 4.1)", () => {
  it("the save answers the stored value and an Undo payload of prior and written (mutation: undoPayload.prior = the new value -> FAILS)", async () => {
    db.updateDocumentField.mockResolvedValue("updated");
    expect(await A.updateDocumentFieldAction(ACC, D, "title", "  Signed lease ")).toEqual({
      ok: true, shown: "Signed lease", undoPayload: { documentId: D, field: "title", prior: "Lease", written: "Signed lease" } });
    expect(db.updateDocumentField).toHaveBeenCalledWith(SERVICE, ACC, D, "title", "Signed lease");
  });
  it("Undo writes the prior value only where the written one still stands; otherwise says so (mutation: call without expected -> FAILS)", async () => {
    db.updateDocumentField.mockResolvedValue("changed");
    expect(await A.undoDocumentFieldAction(ACC, { documentId: D, field: "title", prior: "Lease", written: "Signed lease" }))
      .toEqual({ ok: false, error: "documents.undoChanged" });
    expect(db.updateDocumentField).toHaveBeenCalledWith(SERVICE, ACC, D, "title", "Lease", { value: "Signed lease" });
  });
  it("a document in the trash is never edited, and is never trashed twice (mutation: let the proof pass a trashed document -> FAILS)", async () => {
    db.getDocument.mockResolvedValue({ ...DOC, deleted_at: "2026-10-13T15:00:00Z", deleted_by: "user_owner" });
    expect(await A.updateDocumentFieldAction(ACC, D, "title", "New")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(await A.trashDocumentAction(ACC, D)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.updateDocumentField).not.toHaveBeenCalled();
    expect(db.trashDocument).not.toHaveBeenCalled();
  });
  it("a forged Undo payload is refused before any read (mutation: trust the field name -> FAILS)", async () => {
    // null prior/written pass the date branch, so only the field check can refuse this (with "x" the date check refused it either way).
    expect(await A.undoDocumentFieldAction(ACC, { documentId: D, field: "owners_only", prior: null, written: null }))
      .toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.getDocument).not.toHaveBeenCalled();
  });
  it("Owners only is the Owner's and the agency's; Staff is refused even with a document they see (mutation: drop the role check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await A.setOwnersOnlyAction(ACC, D, true)).toEqual({ ok: false, error: "documents.error.ownersOnlyRole" });
    expect(await A.undoOwnersOnlyAction(ACC, D, false, true)).toEqual({ ok: false, error: "documents.error.ownersOnlyRole" });
    expect(db.setDocumentOwnersOnly).not.toHaveBeenCalled();
  });
});

describe("trash and restore (spec 4.4)", () => {
  it("trash answers the stored instant for the Undo; restore compares against it (mutation: restore ignores the instant -> FAILS)", async () => {
    db.trashDocument.mockResolvedValue({ status: "trashed", deletedAt: "2026-10-13T15:00:00.123456+00:00" });
    expect(await A.trashDocumentAction(ACC, D)).toEqual({ ok: true, deletedAt: "2026-10-13T15:00:00.123456+00:00" });
    db.getDocument.mockResolvedValue({ ...DOC, deleted_at: "2026-10-13T15:00:00.123456+00:00", deleted_by: "user_owner" });
    db.restoreDocument.mockResolvedValue("changed");
    expect(await A.restoreDocumentAction(ACC, D, "2026-10-13T15:00:00.123456+00:00")).toEqual({ ok: false, error: "documents.undoChanged" });
    expect(db.restoreDocument).toHaveBeenCalledWith(SERVICE, ACC, D, "2026-10-13T15:00:00.123456+00:00", "user_owner");
  });
  it("a document the caller cannot see is never trashed (mutation: skip the request-client read -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(null);
    expect(await A.trashDocumentAction(ACC, D)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.trashDocument).not.toHaveBeenCalled();
  });
});

describe("every document action proves the document on the REQUEST client before its service write (review I1)", () => {
  const SIX = [
    ["edit", () => A.updateDocumentFieldAction(ACC, D, "title", "New"), db.updateDocumentField],
    ["undo edit", () => A.undoDocumentFieldAction(ACC, { documentId: D, field: "title", prior: "Lease", written: "New" }), db.updateDocumentField],
    ["owners only", () => A.setOwnersOnlyAction(ACC, D, true), db.setDocumentOwnersOnly],
    ["undo owners only", () => A.undoOwnersOnlyAction(ACC, D, false, true), db.setDocumentOwnersOnly],
    ["trash", () => A.trashDocumentAction(ACC, D), db.trashDocument],
    ["restore", () => A.restoreDocumentAction(ACC, D, "2026-10-13T15:00:00Z"), db.restoreDocument],
  ] as const;
  beforeEach(() => {
    db.updateDocumentField.mockResolvedValue("updated");
    db.setDocumentOwnersOnly.mockResolvedValue("updated");
    db.trashDocument.mockResolvedValue({ status: "trashed", deletedAt: "2026-10-13T15:00:00Z" });
    db.restoreDocument.mockResolvedValue("updated");
  });
  it.each(SIX)("%s: the first document read is on the request client, before the service write (mutation: read it on serviceDb() -> FAILS)", async (_l, run, write) => {
    expect((await run()).ok).toBe(true);
    expect(db.getDocument.mock.calls[0]![0]).toBe(REQUEST);
    expect(db.getDocument.mock.calls[0]!.slice(1)).toEqual([ACC, D]);
    expect(write.mock.calls[0]![0]).toBe(SERVICE);
    expect(db.getDocument.mock.invocationCallOrder[0]!).toBeLessThan(write.mock.invocationCallOrder[0]!);
  });
  it.each(SIX)("%s: a document the caller cannot see is refused and nothing is written (mutation: skip the request-client read -> FAILS)", async (_l, run, write) => {
    db.getDocument.mockResolvedValue(null);
    expect(await run()).toEqual({ ok: false, error: "documents.error.refused" });
    expect(write).not.toHaveBeenCalled();
  });
});

describe("nothing throws out of an action (the tree's convention)", () => {
  it.each([
    ["start", () => A.startDocumentUploadAction(ACC, input()), "documents.error.upload"],
    ["finish", () => A.finishDocumentUploadAction(ACC, D, V), "documents.error.upload"],
    ["abandon", () => A.abandonDocumentUploadAction(ACC, D, V), "documents.error.failed"],
    ["url", () => A.getDocumentUrlAction(ACC, V, "view"), "documents.error.open"],
    ["edit", () => A.updateDocumentFieldAction(ACC, D, "title", "x"), "documents.error.failed"],
    ["undo edit", () => A.undoDocumentFieldAction(ACC, { documentId: D, field: "title", prior: "a", written: "b" }), "documents.error.failed"],
    ["owners only", () => A.setOwnersOnlyAction(ACC, D, true), "documents.error.failed"],
    ["undo owners only", () => A.undoOwnersOnlyAction(ACC, D, false, true), "documents.error.failed"],
    ["trash", () => A.trashDocumentAction(ACC, D), "documents.error.failed"],
    ["restore", () => A.restoreDocumentAction(ACC, D, "2026-10-13T15:00:00Z"), "documents.error.failed"],
    ["start version", () => A.startDocumentVersionUploadAction(ACC, D, { name: "a.pdf", size: 10, contentType: "application/pdf" }), "documents.error.upload"],
    ["purge", () => A.purgeDocumentAction(ACC, D, "Lease"), "documents.error.purge"],
  ] as const)("%s: a failed request-client read answers its key (mutation: drop that action's try/catch -> FAILS)", async (_l, run, error) => {
    db.getContact.mockRejectedValue(new Error("db down"));
    db.getDocument.mockRejectedValue(new Error("db down"));
    db.getDocumentVersion.mockRejectedValue(new Error("db down"));
    await expect(run()).resolves.toEqual({ ok: false, error });
  });
});
