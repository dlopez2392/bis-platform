import { describe, it, expect, vi, afterEach } from "vitest";
import type { UploadDeps } from "./upload-client";
// "use server" modules cannot load in vitest; every dependency is injected through UploadDeps below.
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions", () => ({
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
}));
const { prepareFile, uploadOne, xhrPut, UPLOAD_STALL_MS } = await import("./upload-client");

const C = "11111111-1111-4111-8111-111111111111";
const batch = { record: { kind: "contact" as const, id: C }, ownersOnly: false, expiresOn: null, source: "upload" as const };
const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

function deps(over: Partial<UploadDeps> = {}): UploadDeps & { calls: string[] } {
  const calls: string[] = [];
  const d = {
    calls,
    strip: vi.fn(async (f: Blob) => { calls.push("strip"); return new Blob([await f.arrayBuffer()], { type: f.type }); }),
    start: vi.fn(async () => { calls.push("start"); return { ok: true as const, documentId: "d", versionId: "v", uploadUrl: "https://u" }; }),
    put: vi.fn(async (_u: string, _b: Blob, _t: string, p: (n: number) => void) => { calls.push("put"); p(45); p(100); return true; }),
    finish: vi.fn(async () => { calls.push("finish"); return { ok: true as const }; }),
    abandon: vi.fn(async () => { calls.push("abandon"); return { ok: true as const }; }),
    ...over,
  };
  return d as unknown as UploadDeps & { calls: string[] };
}
const mockOf = (f: unknown) => f as ReturnType<typeof vi.fn>;

describe("prepareFile (spec 4.2, 5.3)", () => {
  it("an image is re-encoded before anything is sent; a PDF is sent as given (mutation: strip every file -> FAILS)", async () => {
    const d = deps();
    await prepareFile(file("a.jpg", "image/jpeg"), d.strip);
    const pdf = file("a.pdf", "application/pdf");
    const r = await prepareFile(pdf, d.strip);
    expect(d.strip).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, blob: pdf, contentType: "application/pdf" });
  });
  it("the declared type is what the browser produced (Safari's WebP comes back PNG) (mutation: declare the input's type -> FAILS)", async () => {
    const r = await prepareFile(file("a.webp", "image/webp"), async () => new Blob([new Uint8Array(5)], { type: "image/png" }));
    expect(r).toMatchObject({ ok: true, contentType: "image/png" });
  });
  it("HEIC and SVG are refused with the kind-of-file sentence; oversize AFTER the re-encode with the size (mutation: check the size before the re-encode -> FAILS)", async () => {
    expect(await prepareFile(file("a.heic", "image/heic"), deps().strip)).toEqual({ ok: false, error: "documents.error.badType" });
    expect(await prepareFile(file("a.svg", "image/svg+xml"), deps().strip)).toEqual({ ok: false, error: "documents.error.badType" });
    const big = await prepareFile(file("a.png", "image/png", 10), async () => new Blob([new Uint8Array(26_214_401)], { type: "image/png" }));
    expect(big).toEqual({ ok: false, error: "documents.error.tooLarge", params: { size: "25.1 MB" } });
  });
  it("the browser's oversize size rounds UP like the server's: 26,230,000 bytes reads 25.1 MB, never \"25 MB\" beside a 25 MB limit (mutation: round to nearest -> FAILS)", async () => {
    const r = await prepareFile(file("a.pdf", "application/pdf", 26_230_000), deps().strip);
    expect(r).toEqual({ ok: false, error: "documents.error.tooLarge", params: { size: "25.1 MB" } });
  });
  it("an image the browser cannot redraw is refused as Couldn't upload, never sent unstripped (mutation: fall back to the original file -> FAILS)", async () => {
    const r = await prepareFile(file("a.jpg", "image/jpeg"), async () => { throw new Error("decode"); });
    expect(r).toEqual({ ok: false, error: "documents.error.upload" });
  });
});

describe("uploadOne: start, PUT, finish, in that order (spec 4.2, V6)", () => {
  it("reports Uploading n%, then Checking, then done (mutation: report done before finish -> FAILS)", async () => {
    const d = deps();
    const phases: unknown[] = [];
    const end = await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, d, (p) => phases.push(p));
    expect(d.calls).toEqual(["start", "put", "finish"]);
    expect(phases).toEqual([{ kind: "uploading", percent: 0 }, { kind: "uploading", percent: 45 }, { kind: "uploading", percent: 100 }, { kind: "checking" }]);
    expect(end).toEqual({ kind: "done" });
  });
  it("a failed PUT abandons the reservation at once and says Couldn't upload (mutation: skip abandon -> FAILS)", async () => {
    const d = deps({ put: vi.fn(async () => false) });
    const end = await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, d, () => {});
    expect(d.abandon).toHaveBeenCalledWith("acc", "d", "v");
    expect(end).toEqual({ kind: "failed", error: "documents.error.upload" });
    expect(d.finish).not.toHaveBeenCalled();
  });
  it("the server's refusal is passed through with its key and params; nothing is PUT (mutation: PUT before start answers -> FAILS)", async () => {
    const d = deps({ start: vi.fn(async () => ({ ok: false as const, error: "documents.error.quota" })) });
    expect(await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, d, () => {}))
      .toEqual({ kind: "failed", error: "documents.error.quota" });
    expect(d.put).not.toHaveBeenCalled();
  });
  it("sends the batch's Owners only, expiry and source with each file (mutation: drop ownersOnly from the start input -> FAILS)", async () => {
    const d = deps();
    await uploadOne("acc", { file: file("a.jpg", "image/jpeg"), title: "a", category: "photo" },
      { ...batch, ownersOnly: true, expiresOn: "2026-12-01", source: "camera" }, d, () => {});
    expect(mockOf(d.start).mock.calls[0]![1]).toMatchObject({
      ownersOnly: true, expiresOn: "2026-12-01", source: "camera", contentType: "image/jpeg", category: "photo", name: "a.jpg", title: "a" });
  });
  it("the size declared to the server and the bytes PUT are the RE-ENCODED image's, stripped before start (mutation: declare the chosen file's size -> FAILS)", async () => {
    const stripped = new Blob([new Uint8Array(7)], { type: "image/jpeg" });
    const d = deps();
    d.strip = vi.fn(async () => { d.calls.push("strip"); return stripped; });
    await uploadOne("acc", { file: file("a.jpg", "image/jpeg", 10), title: "a", category: "photo" }, batch, d, () => {});
    expect(d.calls).toEqual(["strip", "start", "put", "finish"]);
    expect(mockOf(d.start).mock.calls[0]![1]).toMatchObject({ size: 7, record: { kind: "contact", id: C } });
    const [url, body, type] = mockOf(d.put).mock.calls[0]!;
    expect([url, body, type]).toEqual(["https://u", stripped, "image/jpeg"]);
    expect(body).toBe(stripped);
  });
  it("PUTs with the type the browser PRODUCED, not the chosen file's own (Safari's WebP comes back PNG) (mutation: PUT with the chosen file's own type -> FAILS)", async () => {
    const d = deps({ strip: vi.fn(async () => new Blob([new Uint8Array(5)], { type: "image/png" })) });
    await uploadOne("acc", { file: file("a.webp", "image/webp"), title: "a", category: "photo" }, batch, d, () => {});
    expect(mockOf(d.start).mock.calls[0]![1]).toMatchObject({ contentType: "image/png", name: "a.webp" });
    expect(mockOf(d.put).mock.calls[0]![2]).toBe("image/png");
  });
  it("finish's refusal reaches the card with its key; a start that throws is Couldn't upload with nothing PUT (mutation: report done whatever finish answers -> FAILS)", async () => {
    const refused = deps({ finish: vi.fn(async () => ({ ok: false as const, error: "documents.error.badType" })) });
    expect(await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, refused, () => {}))
      .toEqual({ kind: "failed", error: "documents.error.badType" });
    const thrown = deps({ start: vi.fn(async () => { throw new Error("network"); }) });
    expect(await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, thrown, () => {}))
      .toEqual({ kind: "failed", error: "documents.error.upload" });
    expect(thrown.put).not.toHaveBeenCalled();
  });
});

/**
 * xhrPut runs in the browser; a fake XMLHttpRequest records what it is asked to do and lets the test
 * play the network's part. The headers are the ones storage-js's uploadToSignedUrl sends for a raw body
 * (x-upsert, cache-control, content-type; read off @supabase/storage-js 2.110.8 dist/index.mjs:776-779):
 * finish compares the type storage holds with the declared one, so the content-type header is load-bearing.
 */
describe("xhrPut (spec 4.2: progress, straight to storage)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  class FakeXhr {
    static last: FakeXhr;
    method = ""; url = ""; status = 0; sent: unknown = undefined;
    headers: Record<string, string> = {};
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor() { FakeXhr.last = this; }
    open(method: string, url: string) { this.method = method; this.url = url; }
    setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
    send(body: unknown) { this.sent = body; }
    aborted = false;
    abort() { this.aborted = true; this.onabort?.(); }
  }

  it("PUTs the blob itself with the declared type, never cacheable, and reports whole percents (mutation: drop the content-type header, or cache-control max-age=3600 -> FAILS)", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const body = new Blob([new Uint8Array(3)], { type: "image/png" });
    const seen: number[] = [];
    const p = xhrPut("https://storage/x?token=t", body, "image/png", (n) => seen.push(n));
    const x = FakeXhr.last;
    expect([x.method, x.url, x.sent]).toEqual(["PUT", "https://storage/x?token=t", body]);
    expect(x.headers).toEqual({ "content-type": "image/png", "x-upsert": "false", "cache-control": "private, no-store" });
    x.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 3 });
    x.upload.onprogress!({ lengthComputable: false, loaded: 2, total: 0 });
    x.upload.onprogress!({ lengthComputable: true, loaded: 3, total: 3 });
    x.status = 200;
    x.onload!();
    expect(await p).toBe(true);
    expect(seen).toEqual([33, 100]);
  });

  it("a refusal status, a network error and an abort all answer false (mutation: treat any load as success -> FAILS)", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const body = new Blob([new Uint8Array(1)]);
    const refused = xhrPut("https://u", body, "application/pdf", () => {});
    FakeXhr.last.status = 403;
    FakeXhr.last.onload!();
    const errored = xhrPut("https://u", body, "application/pdf", () => {});
    FakeXhr.last.onerror!();
    const aborted = xhrPut("https://u", body, "application/pdf", () => {});
    FakeXhr.last.onabort!();
    expect([await refused, await errored, await aborted]).toEqual([false, false, false]);
  });

  it("an upload with no progress for UPLOAD_STALL_MS is aborted and answers false; progress resets the clock (mutation: no stall timer -> FAILS)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("XMLHttpRequest", FakeXhr);
      let answer: boolean | undefined;
      void xhrPut("https://u", new Blob([new Uint8Array(1)]), "application/pdf", () => {}).then((v) => { answer = v; });
      const x = FakeXhr.last;
      await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 1_000);
      x.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 });
      await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 1_000);
      expect(answer).toBeUndefined();
      expect(x.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(x.aborted).toBe(true);
      expect(answer).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a finished upload stops the stall clock (mutation: never clear the timer -> FAILS)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("XMLHttpRequest", FakeXhr);
      const p = xhrPut("https://u", new Blob([new Uint8Array(1)]), "application/pdf", () => {});
      const x = FakeXhr.last;
      x.status = 200;
      x.onload!();
      expect(await p).toBe(true);
      await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS * 2);
      expect(x.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
