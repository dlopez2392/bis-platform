import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const recordDocumentScan = vi.fn();
const signedScannerUrl = vi.fn();
vi.mock("@bis/db", () => ({
  DOCUMENT_BUCKET: "documents",
  recordDocumentScan: (...a: unknown[]) => { calls.push(`record:${(a[1] as { verdict: string }).verdict}`); return recordDocumentScan(...a); },
  signedScannerUrl: (...a: unknown[]) => { calls.push("mint"); return signedScannerUrl(...a); },
}));
const { scanVersion, spendScanError, MAX_SCAN_ATTEMPTS } = await import("./scan-version");

const remove = vi.fn();
const list = vi.fn();
const DB = { storage: { from: vi.fn(() => ({
  remove: (...a: unknown[]) => { calls.push("remove"); return remove(...a); },
  list: (...a: unknown[]) => { calls.push("list"); return list(...a); },
})) } } as never;
const V = { accountId: "acc", versionId: "ver", storagePath: "acc/doc/ver", attempts: 0 };
const deps = (verdict: unknown, configured = true) => ({
  configured: () => configured,
  scan: vi.fn(async () => { calls.push("scan"); return verdict as never; }),
});

beforeEach(() => {
  calls.length = 0;
  recordDocumentScan.mockReset(); signedScannerUrl.mockReset(); remove.mockReset(); list.mockReset();
  signedScannerUrl.mockResolvedValue("https://s/sign");
  remove.mockResolvedValue({ data: [], error: null });
  list.mockResolvedValue({ data: [], error: null });
});

describe("scanVersion (spec 3.2-3.4; owner decision P4: nothing infected is kept)", () => {
  it("not configured: Checking stays, nothing is minted, scanned, recorded or removed (mutation: scan anyway -> FAILS)", async () => {
    expect(await scanVersion(DB, V, deps({ verdict: "clean" }, false))).toBe("pending");
    expect(calls).toEqual([]);
  });

  it("clean: mint the scanner's own URL for THIS path, scan it, record clean; nothing removed (mutation: mint for another path -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    const d = deps({ verdict: "clean" });
    expect(await scanVersion(DB, V, d)).toBe("clean");
    expect(signedScannerUrl).toHaveBeenCalledWith(DB, "acc/doc/ver");
    expect(d.scan).toHaveBeenCalledWith("https://s/sign");
    expect(calls).toEqual(["mint", "scan", "record:clean"]);
  });

  it("infected: the OBJECT goes first, then the verdict with its name (mutation: record before removing -> the order FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    expect(await scanVersion(DB, V, deps({ verdict: "infected", signature: "Eicar-Test-Signature" }))).toBe("infected");
    expect(calls).toEqual(["mint", "scan", "remove", "record:infected"]);
    expect(remove).toHaveBeenCalledWith(["acc/doc/ver"]);
    expect(recordDocumentScan).toHaveBeenCalledWith(DB, { accountId: "acc", versionId: "ver", verdict: "infected", signature: "Eicar-Test-Signature" });
  });

  it("content clamd could not read is removed as unscannable at once, object first, and clamd's named cause is KEPT so the note can say 'it has a password' (plan review C2; owner ruling 2026-10-15; mutations: treat it as clean -> FAILS; pass null for the signature -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    expect(await scanVersion(DB, V, deps({ verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" }))).toBe("unscannable");
    expect(calls).toEqual(["mint", "scan", "remove", "record:unscannable"]);
    expect(recordDocumentScan).toHaveBeenCalledWith(DB, { accountId: "acc", versionId: "ver", verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
  });

  it("the unscannable path SPECIFICALLY carries the signature it was given, whatever it says (a limit as well as a password) (final check R1; mutation: drop or replace the signature on the unscannable branch only -> FAILS, while the infected case above stays green)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    await scanVersion(DB, V, deps({ verdict: "unscannable", signature: "Heuristics.Limits.Exceeded.MaxScanSize" }));
    const unscannableCalls = recordDocumentScan.mock.calls.filter((c) => (c[1] as { verdict: string }).verdict === "unscannable");
    expect(unscannableCalls.map((c) => (c[1] as { signature: string | null }).signature)).toEqual(["Heuristics.Limits.Exceeded.MaxScanSize"]);
  });

  it("an object that will not go THROWS and records nothing, so the version stays pending for the next pass (mutation: record anyway -> FAILS)", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "storage down" } });
    await expect(scanVersion(DB, V, deps({ verdict: "infected", signature: "X" }))).rejects.toThrow(/not removed/);
    expect(recordDocumentScan).not.toHaveBeenCalled();
  });

  it("a transport error (a 403, a 429, any timeout) never counts and writes nothing, even with attempts at two (plan review C1, final check R2; mutation: count it -> FAILS)", async () => {
    expect(await scanVersion(DB, { ...V, attempts: 2 }, deps({ verdict: "error", cause: "transport" }))).toBe("unreached");
    expect(calls).toEqual(["mint", "scan"]);
  });

  it("'missing' counts ONLY when the app confirms the object is gone with its own storage list (final check R2; mutations: count without the list -> the 'found' half FAILS; never count -> the 'gone' half FAILS)", async () => {
    // The object IS there: storage's not-found was wrong (or a race); nothing counts.
    list.mockResolvedValueOnce({ data: [{ name: "ver" }], error: null });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "missing" }), { holdErrors: true })).toBe("unreached");
    expect(list).toHaveBeenCalledWith("acc/doc", { search: "ver", limit: 10 });
    // The list itself fails: cannot confirm, nothing counts.
    list.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "missing" }), { holdErrors: true })).toBe("unreached");
    // Confirmed gone: it is held for the pass to spend.
    list.mockResolvedValueOnce({ data: [{ name: "other" }], error: null });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "missing" }), { holdErrors: true })).toBe("held");
    expect(recordDocumentScan).not.toHaveBeenCalled();
  });

  it("a clamd error spends an attempt and stays Checking; the THIRD removes the object and records unscannable with the generic cause (mutations: MAX 4 -> FAILS; skip the remove -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: 1 });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "clamd" }))).toBe("pending");
    expect(calls).toEqual(["mint", "scan", "record:error"]);
    calls.length = 0;
    recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: MAX_SCAN_ATTEMPTS }).mockResolvedValueOnce({ status: "ok", attempts: MAX_SCAN_ATTEMPTS + 1 });
    expect(await scanVersion(DB, { ...V, attempts: 2 }, deps({ verdict: "error", cause: "clamd" }))).toBe("unscannable");
    expect(calls).toEqual(["mint", "scan", "record:error", "remove", "record:unscannable"]);
    expect(MAX_SCAN_ATTEMPTS).toBe(3);
  });

  it("holdErrors: a clamd error is HELD, nothing written, for the pass to spend or not (its breaker); spendScanError spends it later (mutation: write while holding -> FAILS)", async () => {
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "clamd" }), { holdErrors: true })).toBe("held");
    expect(calls).toEqual(["mint", "scan"]);
    calls.length = 0;
    recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: 1 });
    expect(await spendScanError(DB, V)).toBe("pending");
    expect(calls).toEqual(["record:error"]);
  });

  it("a version that already used its three attempts is given up WITHOUT another scan (a crash between the third error and its removal) (mutation: scan again -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 4 });
    expect(await scanVersion(DB, { ...V, attempts: 3 }, deps({ verdict: "clean" }))).toBe("unscannable");
    expect(calls).toEqual(["remove", "record:unscannable"]);
  });

  it("a verdict someone else recorded first is stale, and the caller learns it (mutation: answer clean on stale -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "stale" });
    expect(await scanVersion(DB, V, deps({ verdict: "clean" }))).toBe("stale");
  });

  it("M5: removeThenRecord's 'stale' answer comes back AFTER the object is already gone — log an error naming the version id, never a URL or token (mutation: drop the log -> FAILS)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    recordDocumentScan.mockResolvedValue({ status: "stale" });
    expect(await scanVersion(DB, V, deps({ verdict: "infected", signature: "Eicar-Test-Signature" }))).toBe("stale");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ver"));
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).not.toMatch(/https?:\/\/|token=/);
    errorSpy.mockRestore();
  });

  describe("review fix 2: signedScannerUrl throws when the object is already gone (infected removed, a crash before the verdict, attempts < 3) and createSignedUrl refuses a non-existent object", () => {
    it("mint fails, the app's OWN list confirms the object gone: a countable 'missing', exactly like the worker's (held under holdErrors; never scanned since minting failed) (mutation: route it to 'unreached' instead -> FAILS)", async () => {
      signedScannerUrl.mockRejectedValueOnce(new Error("signedScannerUrl failed: Object not found"));
      expect(await scanVersion(DB, V, deps({ verdict: "clean" }), { holdErrors: true })).toBe("held");
      expect(list).toHaveBeenCalledWith("acc/doc", { search: "ver", limit: 10 });
      expect(calls).toEqual(["mint", "list"]);
      expect(recordDocumentScan).not.toHaveBeenCalled();
    });

    it("mint fails, confirmedMissing spends it like any other countable error when not held (mutation: never count a mint failure -> the version throws every pass forever)", async () => {
      signedScannerUrl.mockRejectedValueOnce(new Error("signedScannerUrl failed: Object not found"));
      recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: 1 });
      expect(await scanVersion(DB, V, deps({ verdict: "clean" }))).toBe("pending");
      expect(calls).toEqual(["mint", "list", "record:error"]);
    });

    it("mint fails but the object IS still there (storage's refusal was something else, or a race): nothing counts, nothing is scanned (mutation: count it anyway -> FAILS)", async () => {
      signedScannerUrl.mockRejectedValueOnce(new Error("signedScannerUrl failed: storage down"));
      list.mockResolvedValueOnce({ data: [{ name: "ver" }], error: null });
      expect(await scanVersion(DB, V, deps({ verdict: "clean" }))).toBe("unreached");
      expect(calls).toEqual(["mint", "list"]);
      expect(recordDocumentScan).not.toHaveBeenCalled();
    });

    it("mint fails and the confirming list itself fails: cannot confirm, nothing counts (mutation: count it anyway -> FAILS)", async () => {
      signedScannerUrl.mockRejectedValueOnce(new Error("signedScannerUrl failed: Object not found"));
      list.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
      expect(await scanVersion(DB, V, deps({ verdict: "clean" }))).toBe("unreached");
      expect(recordDocumentScan).not.toHaveBeenCalled();
    });
  });
});
