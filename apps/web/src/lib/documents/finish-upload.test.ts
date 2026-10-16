import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const getUploadingVersion = vi.fn();
const getDocumentVersion = vi.fn();
const markDocumentVersionReady = vi.fn();
const discardDocumentUpload = vi.fn<(...a: unknown[]) => Promise<void>>(async () => { calls.push("rows"); });
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  getUploadingVersion: (...a: unknown[]) => getUploadingVersion(...a),
  getDocumentVersion: (...a: unknown[]) => getDocumentVersion(...a),
  markDocumentVersionReady: (...a: unknown[]) => markDocumentVersionReady(...a),
  discardDocumentUpload: (...a: unknown[]) => discardDocumentUpload(...a),
}));
const scanVersion = vi.fn();
vi.mock("@/lib/documents/scan-version", () => ({ scanVersion: (...a: unknown[]) => scanVersion(...a) }));
const { finishStoredUpload } = await import("./finish-upload");

const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
function svc(blob: Blob | null) {
  return {
    storage: { from: () => ({
      download: async () => (blob ? { data: blob, error: null } : { data: null, error: { message: "gone" } }),
      remove: async () => { calls.push("object"); return { data: [], error: null }; },
    }) },
  } as never;
}
const V = { id: "v1", document_id: "d1", account_id: "a1", storage_path: "a1/d1/v1", bytes: PDF.length, content_type: "application/pdf", status: "uploading" };
const A = { accountId: "a1", documentId: "d1", versionId: "v1", trashed: false, actorId: "customer:r1", actorType: "system" as const };

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); getUploadingVersion.mockResolvedValue(V); markDocumentVersionReady.mockResolvedValue(true); scanVersion.mockResolvedValue("clean"); });

describe("finishStoredUpload: the staff finish's body, now shared (spec 4.4: customer uploads are checked and scanned exactly like staff uploads)", () => {
  it("checks the bytes, marks ready as the given actor, and scans with holdErrors (mutation: drop holdErrors -> FAILS; drop actorType -> FAILS)", async () => {
    const r = await finishStoredUpload(svc(new Blob([PDF], { type: "application/pdf" })), A);
    expect(r).toEqual({ ok: true, scan: "clean" });
    expect(markDocumentVersionReady.mock.calls[0]![1]).toMatchObject({ accountId: "a1", documentId: "d1", versionId: "v1", bytes: PDF.length, actorId: "customer:r1", actorType: "system" });
    expect(scanVersion.mock.calls[0]![1]).toEqual({ accountId: "a1", versionId: "v1", storagePath: "a1/d1/v1", attempts: 0 });
    expect(scanVersion.mock.calls[0]![3]).toEqual({ holdErrors: true });
  });
  it("a size that differs from the reservation removes the object THEN the rows, and refuses (mutation: rows first -> FAILS)", async () => {
    const r = await finishStoredUpload(svc(new Blob([PDF, PDF], { type: "application/pdf" })), A);
    expect(r).toEqual({ ok: false, error: "documents.error.upload" });
    expect(calls).toEqual(["object", "rows"]);
    expect(markDocumentVersionReady).not.toHaveBeenCalled();
  });
  it("bytes that are not the declared type answer badType (mutation: skip checkDocumentBytes -> FAILS)", async () => {
    const fake = new TextEncoder().encode("MZ".padEnd(PDF.length, "x"));
    expect(await finishStoredUpload(svc(new Blob([fake], { type: "application/pdf" })), A)).toEqual({ ok: false, error: "documents.error.badType" });
  });
  it("a trashed file's upload is removed and refused; no object downloadable leaves the rows for the sweep (mutation: clean up on a failed download -> FAILS)", async () => {
    expect(await finishStoredUpload(svc(new Blob([PDF], { type: "application/pdf" })), { ...A, trashed: true })).toEqual({ ok: false, error: "documents.error.trashed" });
    calls.length = 0;
    expect(await finishStoredUpload(svc(null), A)).toEqual({ ok: false, error: "documents.error.upload" });
    expect(calls).toEqual([]);
  });
  it("no uploading row: an orphan object at the reserved path is removed only when no row of that id exists (mutation: remove when a ready row exists -> FAILS)", async () => {
    getUploadingVersion.mockResolvedValue(null);
    getDocumentVersion.mockResolvedValue({ id: "v1", status: "ready" });
    expect(await finishStoredUpload(svc(null), A)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(calls).toEqual([]);
    getDocumentVersion.mockResolvedValue(null);
    await finishStoredUpload(svc(null), A);
    expect(calls).toEqual(["object"]);
  });
});
