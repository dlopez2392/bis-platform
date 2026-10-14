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
  serviceDb: vi.fn(() => SERVICE),
};
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...db, DOCUMENT_BUCKET: real.DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES: real.DOCUMENT_MAX_BYTES,
    isDocumentCategory: real.isDocumentCategory, isDocumentContentType: real.isDocumentContentType };
});
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
  original_name: null, created_at: "x", content_type: contentType });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAccountAccess.mockResolvedValue(OWNER);
  db.getContact.mockResolvedValue({ id: C });
  db.createDocument.mockResolvedValue(D);
  db.reserveDocumentVersion.mockResolvedValue({ status: "ok", versionId: V, storagePath: `${ACC}/${D}/${V}` });
  storage.createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "https://x/upload?token=t", token: "t", path: "p" }, error: null });
  db.getDocument.mockResolvedValue(DOC);
  db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: `${ACC}/${D}/${V}`, bytes: PDF.length, content_type: "application/pdf", original_name: "Lease.pdf", status: "uploading", created_at: "x" });
  storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
  storage.remove.mockResolvedValue({ data: [], error: null });
  db.markDocumentVersionReady.mockResolvedValue(true);
  // The real discard is async: a bare vi.fn() would answer undefined, and cleanUp's .catch on it would throw.
  db.discardDocumentUpload.mockResolvedValue(undefined);
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
    ["oversize", input({ size: 26_214_401 }), { ok: false, error: "documents.error.tooLarge", params: { size: "25 MB" } }],
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
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true });
    const call = db.markDocumentVersionReady.mock.calls[0]![1] as { bytes: number; sha256: string };
    expect(call.bytes).toBe(PDF.length);
    expect(call.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
  });
  it.each([
    ["a missing object", () => storage.download.mockResolvedValue({ data: null, error: { message: "not found" } }), "documents.error.upload"],
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
  it("the stored type is compared as a media type: case and parameters do not refuse a real PDF (mutation: compare blob.type raw -> FAILS)", async () => {
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "Application/PDF; charset=binary" }), error: null });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true });
  });
  it("the stored type's case is folded by the action itself, not only by Blob (mutation: drop the toLowerCase -> FAILS)", async () => {
    // A real Blob lowercases its own type, so the Blob case above cannot catch a missing toLowerCase.
    // A body whose type keeps its capitals can.
    storage.download.mockResolvedValue({ data: { type: "Application/PDF", arrayBuffer: async () => PDF.slice().buffer }, error: null });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true });
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
  it("refuses a version the reader cannot see (RLS read on the request client) and mints nothing (mutation: read the version on the service client -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(null);
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.getDocumentVersion).toHaveBeenCalledWith(REQUEST, ACC, V);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it("mints 120 seconds; Word is always a download named after the title (mutation: mint Word inline -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: 1, status: "ready", original_name: null, created_at: "x",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/sign" }, error: null });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toMatchObject({ ok: true, url: "https://x/sign" });
    expect(storage.createSignedUrl).toHaveBeenCalledWith("p", 120, { download: "Lease.docx" });
  });
  it("Excel is always a download too (mutation: OFFICE_TYPES without Excel -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/sign" }, error: null });
    await A.getDocumentUrlAction(ACC, V, "view");
    expect(storage.createSignedUrl).toHaveBeenCalledWith("p", 120, { download: "Lease.xlsx" });
  });
  it("a PDF to view opens inline, and the document is proven on the request client too (mutation: always download -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/pdf"));
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/sign" }, error: null });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: true, url: "https://x/sign", contentType: "application/pdf" });
    expect(storage.createSignedUrl).toHaveBeenCalledWith("p", 120, undefined);
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
  });
  it("a version whose document the reader cannot see is refused and nothing is minted (mutation: skip the document read -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/pdf"));
    db.getDocument.mockResolvedValue(null);
    expect(await A.getDocumentUrlAction(ACC, V, "download")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it("a version still uploading is never minted (mutation: drop the ready check -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue({ ...readyVersion("application/pdf"), status: "uploading" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
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
  ] as const)("%s: a failed request-client read answers its key (mutation: drop that action's try/catch -> FAILS)", async (_l, run, error) => {
    db.getContact.mockRejectedValue(new Error("db down"));
    db.getDocument.mockRejectedValue(new Error("db down"));
    db.getDocumentVersion.mockRejectedValue(new Error("db down"));
    await expect(run()).resolves.toEqual({ ok: false, error });
  });
});
