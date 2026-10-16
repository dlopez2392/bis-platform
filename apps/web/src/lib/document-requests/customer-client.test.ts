import { describe, it, expect, vi, afterEach } from "vitest";
import { DOCUMENT_MAX_BYTES } from "@bis/db/document-rules";
import { uploadCustomerFile, browserCustomerDeps, type CustomerDeps, type CustomerPhase } from "./customer-client";

const TOKEN = "tok_Abc-123";
const BASE = `/api/d/${TOKEN}`;
const DOC = "11111111-1111-4111-8111-111111111111";
const VER = "22222222-2222-4222-8222-222222222222";
const URL_ = "https://storage.example/upload/sign/doc?token=signed";
const STARTED = { status: 200, body: { documentId: DOC, versionId: VER, uploadUrl: URL_ } };
const received = { status: 200, body: { state: "received" } };

type Answer = { status: number; body: Record<string, unknown> };
type Call = { op: "post"; path: string; body: unknown } | { op: "put"; url: string; size: number; type: string } | { op: "strip"; type: string };

/** One call log across all three deps, so the ORDER of start, PUT and finish is what is asserted. */
function fake(o: { start?: Answer | "throw"; finish?: Answer | "throw"; puts?: boolean[]; strip?: () => Promise<Blob> } = {}) {
  const log: Call[] = [];
  const puts = [...(o.puts ?? [true])];
  const deps: CustomerDeps = {
    post: async (path, body) => {
      log.push({ op: "post", path, body });
      const a = path.endsWith("/start") ? (o.start ?? STARTED) : (o.finish ?? received);
      if (a === "throw") throw new TypeError("Failed to fetch");
      return a;
    },
    put: async (url, blob, type, onProgress) => {
      log.push({ op: "put", url, size: blob.size, type });
      const ok = puts.shift() ?? false;
      if (ok) { onProgress(45); onProgress(100); }
      return ok;
    },
    strip: async (_file, type) => {
      log.push({ op: "strip", type });
      return o.strip ? o.strip() : new Blob([new Uint8Array(400)], { type });
    },
  };
  return { deps, log };
}
const pdf = () => new File([new Uint8Array(1234)], "Lease 2026.pdf", { type: "application/pdf" });
const jpg = () => new File([new Uint8Array(1000)], "IMG_0042.jpg", { type: "image/jpeg" });

async function run(file: File, deps: CustomerDeps) {
  const phases: CustomerPhase[] = [];
  const end = await uploadCustomerFile(TOKEN, "id", file, deps, (p) => phases.push(p));
  return { end, phases };
}
const ops = (log: Call[]) => log.map((c) => (c.op === "post" ? `post ${c.path}` : c.op));

describe("uploadCustomerFile", () => {
  it("a PDF: start, then the PUT to the signed URL, then finish, answering received, with uploading 0..100 then checking on the way (mutation: finish before the PUT → FAILS)", async () => {
    const { deps, log } = fake();
    const { end, phases } = await run(pdf(), deps);
    expect(end).toEqual({ kind: "received" });
    expect(ops(log)).toEqual([`post ${BASE}/start`, "put", `post ${BASE}/finish`]);
    expect(log[0]).toEqual({ op: "post", path: `${BASE}/start`, body: { itemKey: "id", name: "Lease 2026.pdf", size: 1234, contentType: "application/pdf" } });
    expect(log[1]).toEqual({ op: "put", url: URL_, size: 1234, type: "application/pdf" });
    expect(log[2]).toEqual({ op: "post", path: `${BASE}/finish`, body: { documentId: DOC, versionId: VER } });
    expect(phases).toEqual([
      { kind: "uploading", percent: 0 }, { kind: "uploading", percent: 45 }, { kind: "uploading", percent: 100 }, { kind: "checking" },
    ]);
  });

  it("encodes the token into the path (a token is never trusted to be path-safe)", async () => {
    const { deps, log } = fake();
    await uploadCustomerFile("a/b?c", "id", pdf(), deps, () => {});
    expect(log[0]).toMatchObject({ path: "/api/d/a%2Fb%3Fc/start" });
  });

  it("(spec 6) a failed PUT is retried ONCE to the same URL, and then finishes (mutation: no retry → FAILS)", async () => {
    const { deps, log } = fake({ puts: [false, true] });
    const { end } = await run(pdf(), deps);
    expect(end).toEqual({ kind: "received" });
    expect(ops(log)).toEqual([`post ${BASE}/start`, "put", "put", `post ${BASE}/finish`]);
    expect(log.filter((c) => c.op === "put").map((c) => (c as { url: string }).url)).toEqual([URL_, URL_]);
  });

  it("(spec 6) a second failed PUT answers failed and never calls finish; never a third PUT (mutation: two retries → FAILS by the call count)", async () => {
    const { deps, log } = fake({ puts: [false, false, true] });
    const { end } = await run(pdf(), deps);
    expect(end).toEqual({ kind: "failed" });
    expect(ops(log)).toEqual([`post ${BASE}/start`, "put", "put"]);
  });

  it.each<[string, Answer | "throw", CustomerPhase]>([
    ["bad_type", { status: 400, body: { error: "bad_type" } }, { kind: "refused", why: "customerDocs.why.type" }],
    ["too_large", { status: 413, body: { error: "too_large" } }, { kind: "refused", why: "customerDocs.why.size" }],
    ["rate_limited", { status: 429, body: { error: "rate_limited" } }, { kind: "refused", why: "customerDocs.why.limit" }],
    ["over_quota with a phone", { status: 409, body: { error: "over_quota", phone: "(956) 555-0123" } }, { kind: "refused", why: "customerDocs.why.full", params: { phone: "(956) 555-0123" } }],
    ["over_quota without a phone", { status: 409, body: { error: "over_quota" } }, { kind: "refused", why: "customerDocs.why.fullNoPhone" }],
    ["expired", { status: 410, body: { error: "expired" } }, { kind: "closed" }],
    ["revoked", { status: 410, body: { error: "revoked" } }, { kind: "closed" }],
    ["completed", { status: 410, body: { error: "completed" } }, { kind: "closed" }],
    ["not_found", { status: 404, body: { error: "not_found" } }, { kind: "closed" }],
    ["a 503", { status: 503, body: { error: "failed" } }, { kind: "failed" }],
    ["no_item", { status: 400, body: { error: "no_item" } }, { kind: "failed" }],
    ["a network error", "throw", { kind: "failed" }],
    ["a 200 without its three ids", { status: 200, body: { documentId: DOC } }, { kind: "failed" }],
  ])("start answers %s: the right words, and no PUT", async (_name, start, expected) => {
    const { deps, log } = fake({ start });
    const { end } = await run(pdf(), deps);
    expect(end).toEqual(expected);
    expect(ops(log)).toEqual([`post ${BASE}/start`]);
  });

  it("prepareFile's own refusals: a wrong type reads why.type and calls nothing", async () => {
    const { deps, log } = fake();
    const { end } = await run(new File(["x"], "notes.txt", { type: "text/plain" }), deps);
    expect(end).toEqual({ kind: "refused", why: "customerDocs.why.type" });
    expect(log).toEqual([]);
  });

  it("prepareFile's own refusals: over 25 MB AS STORED reads why.size and never starts", async () => {
    const { deps, log } = fake({ strip: async () => new Blob([new Uint8Array(DOCUMENT_MAX_BYTES + 1)], { type: "image/jpeg" }) });
    const { end } = await run(jpg(), deps);
    expect(end).toEqual({ kind: "refused", why: "customerDocs.why.size" });
    expect(ops(log)).toEqual(["strip"]);
  });

  it("prepareFile's own refusals: an image that cannot be redrawn is failed, never sent with its location data", async () => {
    const { deps, log } = fake({ strip: async () => { throw new Error("decode"); } });
    const { end } = await run(jpg(), deps);
    expect(end).toEqual({ kind: "failed" });
    expect(ops(log)).toEqual(["strip"]);
  });

  it.each<[string, CustomerPhase]>([
    ["virus", { kind: "refused", why: "customerDocs.why.virus" }],
    ["password", { kind: "refused", why: "customerDocs.why.password" }],
    ["unscannable", { kind: "refused", why: "customerDocs.why.unscannable" }],
    ["checking", { kind: "checking" }],
    ["received", { kind: "received" }],
    ["something new", { kind: "failed" }],
  ])("finish answers state %s", async (state, expected) => {
    const { deps } = fake({ finish: { status: 200, body: { state } } });
    expect((await run(pdf(), deps)).end).toEqual(expected);
  });

  it.each<[string, Answer | "throw", CustomerPhase]>([
    ["revoked", { status: 410, body: { error: "revoked" } }, { kind: "closed" }],
    ["not_found", { status: 404, body: { error: "not_found" } }, { kind: "closed" }],
    ["bad_type", { status: 400, body: { error: "bad_type" } }, { kind: "refused", why: "customerDocs.why.type" }],
    ["upload", { status: 400, body: { error: "upload" } }, { kind: "failed" }],
    ["a 503 (the server failed AFTER the bytes landed: the file may be stored)", { status: 503, body: { error: "failed" } }, { kind: "failed", maybeStored: true }],
    ["a 504 with no JSON body", { status: 504, body: {} }, { kind: "failed", maybeStored: true }],
    ["a network error (the bytes landed; whether finish ran is unknown)", "throw", { kind: "failed", maybeStored: true }],
  ])("finish refuses with %s (Task 9 review ruling: a failure after a good PUT is maybeStored, so the page re-reads; mutation: plain failed → FAILS)", async (_name, finish, expected) => {
    const { deps } = fake({ finish });
    expect((await run(pdf(), deps)).end).toEqual(expected);
  });

  it("(part 1 §5.3) an image goes through strip BEFORE start, and start is told the STRIPPED size and type (mutation: send file.size → FAILS)", async () => {
    const { deps, log } = fake();
    const { end } = await run(jpg(), deps);
    expect(end).toEqual({ kind: "received" });
    expect(ops(log)).toEqual(["strip", `post ${BASE}/start`, "put", `post ${BASE}/finish`]);
    expect(log[1]).toMatchObject({ body: { size: 400, contentType: "image/jpeg" } });
    expect(log[2]).toMatchObject({ size: 400 });
  });
});

describe("browserCustomerDeps", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("post: fetch with redirect: error and cache: no-store, JSON in and out (2a's redirect defect, designed out; mutation: drop redirect → FAILS)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: "received" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await browserCustomerDeps().post("/api/d/t/finish", { documentId: DOC, versionId: VER });
    expect(answer).toEqual({ status: 200, body: { state: "received" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/d/t/finish", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId: DOC, versionId: VER }), cache: "no-store", redirect: "error",
    });
  });

  it("post: a body that is not JSON reads as an empty object, with the real status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    expect(await browserCustomerDeps().post("/x", {})).toEqual({ status: 502, body: {} });
  });

  it.each(["null", "[1]", "\"text\""])("post: JSON that is not an object (%s) reads as an empty object, so a caller reading body.error never throws", async (raw) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(raw, { status: 200 })));
    expect(await browserCustomerDeps().post("/x", {})).toEqual({ status: 200, body: {} });
  });
});
