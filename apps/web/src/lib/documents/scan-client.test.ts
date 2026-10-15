import { describe, it, expect, vi } from "vitest";
import { scannerConfig, scanSignature, requestScan, scannerHealth } from "./scan-client";

const ENV = { SCANNER_URL: "https://bis-scanner.fly.dev", SCANNER_SECRET: "app-test-secret-0001" };
const BODY = JSON.stringify({ url: "https://abc.supabase.co/storage/v1/object/sign/documents/a/b/c?token=t" });
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const URL_ = "https://abc.supabase.co/storage/v1/object/sign/documents/x/y/z?token=t";

describe("the wire contract (spec 3.1; plan Task 4)", () => {
  it("signs exactly as the worker verifies: the shared vector (mutation: a newline for '.' in the canonical string -> FAILS here AND in services/scanner/test/hmac.test.mjs)", () => {
    expect(scanSignature("test-secret", 1760000000, "POST", "/scan", BODY)).toBe("414f5bcfa4ebd5bb5e060b45bf091d4abfca66fd7bda2dfc2d8e752e64eaec01");
    expect(scanSignature("test-secret", 1760000000, "GET", "/health", "")).toBe("9b16b5e0e7895ed3b63577ae46200cc556595994f9e89e9323a8bd08568a5996");
  });

  it("config: both values, https, or http on loopback only (mutations: accept http anywhere -> FAILS; drop the secret check -> FAILS)", () => {
    expect(scannerConfig(ENV)).toEqual({ origin: "https://bis-scanner.fly.dev", secret: "app-test-secret-0001" });
    expect(scannerConfig({ ...ENV, SCANNER_URL: "http://127.0.0.1:8399" })).toEqual({ origin: "http://127.0.0.1:8399", secret: "app-test-secret-0001" });
    expect(scannerConfig({ ...ENV, SCANNER_URL: "http://bis-scanner.fly.dev" })).toBeNull();
    expect(scannerConfig({ ...ENV, SCANNER_SECRET: " " })).toBeNull();
    expect(scannerConfig({ SCANNER_SECRET: "x" })).toBeNull();
    expect(scannerConfig({ ...ENV, SCANNER_URL: "not a url" })).toBeNull();
  });
});

describe("requestScan: one signed POST, never throws (spec 3.4)", () => {
  it("posts the URL with a fresh timestamp and its signature, and maps clean, infected and unscannable (mutations: sign with the path '/' -> FAILS; map infected to clean -> FAILS; map unscannable to infected -> FAILS)", async () => {
    const fetchImpl = answer(200, { verdict: "infected", signature: "Eicar-Test-Signature" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl, nowSeconds: () => 1760000123 })).toEqual({ verdict: "infected", signature: "Eicar-Test-Signature" });
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(target).toBe("https://bis-scanner.fly.dev/scan");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ url: URL_ }));
    expect(init.headers["x-bis-scan-timestamp"]).toBe("1760000123");
    expect(init.headers["x-bis-scan-signature"]).toBe(scanSignature(ENV.SCANNER_SECRET, 1760000123, "POST", "/scan", JSON.stringify({ url: URL_ })));
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "clean" }) })).toEqual({ verdict: "clean" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" }) }))
      .toEqual({ verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
  });

  it("ONLY a well-formed 200 naming clamd or a missing object carries a countable cause; every other answer is transport (plan review C1, final check R2; mutations: any error as clamd -> FAILS; a 403 as countable -> FAILS; the old 'file' stage as countable -> FAILS)", async () => {
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "error", stage: "clamd" }) })).toEqual({ verdict: "error", cause: "clamd" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "error", stage: "missing" }) })).toEqual({ verdict: "error", cause: "missing" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "error", stage: "file" }) })).toEqual({ verdict: "error", cause: "transport" });
    for (const fetchImpl of [
      answer(200, { verdict: "error", stage: "transport" }), answer(200, { verdict: "error" }),
      answer(401, ""), answer(403, { verdict: "error", stage: "clamd" }), answer(500, ""), answer(200, "nope"),
      answer(200, { verdict: "infected" }), answer(200, { verdict: "maybe" }),
      vi.fn(async () => { throw new Error("ECONNREFUSED"); }),
    ]) {
      expect(await requestScan(URL_, { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ verdict: "error", cause: "transport" });
    }
    const never = vi.fn();
    expect(await requestScan(URL_, { env: {}, fetchImpl: never as unknown as typeof fetch })).toEqual({ verdict: "error", cause: "transport" });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("scannerHealth (spec 3.4: the heartbeat's input)", () => {
  it("maps the worker's answer (mutations: treat clamd:false as ok -> FAILS; accept a missing date -> FAILS)", async () => {
    const at = "2026-10-15T08:27:02.000Z";
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: at, selfTest: true }) })).toEqual({ ok: true, signaturesAt: at });
    // Re-review N2a: PING alone is not health; a clamd that cannot scan fails (mutation: ignore selfTest -> FAILS).
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: at, selfTest: false }) })).toEqual({ ok: false, reason: "self_test_failed" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: at }) })).toEqual({ ok: false, reason: "self_test_failed" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: false }) })).toEqual({ ok: false, reason: "clamd_down" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: null, selfTest: true }) })).toEqual({ ok: false, reason: "bad_answer" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(401, "") })).toEqual({ ok: false, reason: "unreachable" });
    expect(await scannerHealth({ env: ENV, fetchImpl: vi.fn(async () => { throw new Error("x"); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: "unreachable" });
    expect(await scannerHealth({ env: {} })).toEqual({ ok: false, reason: "not_configured" });
  });
});
