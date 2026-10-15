import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listPendingScans = vi.fn();
const oldestPendingScanAt = vi.fn();
const recordHeartbeat = vi.fn();
const recordDocumentScan = vi.fn();
vi.mock("@bis/db", () => ({
  listPendingScans: (...a: unknown[]) => listPendingScans(...a),
  oldestPendingScanAt: (...a: unknown[]) => oldestPendingScanAt(...a),
  recordHeartbeat: (...a: unknown[]) => recordHeartbeat(...a),
  recordDocumentScan: (...a: unknown[]) => recordDocumentScan(...a),
}));
const scannerConfig = vi.fn();
const scannerHealth = vi.fn();
// Orchestrator ruling: SCAN_TIMEOUT_MS is Task 5's committed value, 30_000, not the plan's 25_000.
vi.mock("@/lib/documents/scan-client", () => ({
  scannerConfig: () => scannerConfig(), scannerHealth: () => scannerHealth(), SCAN_TIMEOUT_MS: 30_000, SCANNER_HEARTBEAT_KEY: "documents.scanner",
}));
const scanVersion = vi.fn();
const spendScanError = vi.fn();
vi.mock("@/lib/documents/scan-version", () => ({
  scanVersion: (...a: unknown[]) => scanVersion(...a), spendScanError: (...a: unknown[]) => spendScanError(...a),
}));

const { documentsScanPass, scannerProblem, DOCUMENT_SCAN_BUDGET_MS, DOCUMENT_SCAN_BATCH } = await import("./documents-scan");
const { SCAN_TIMEOUT_MS } = await import("@/lib/documents/scan-client");

const NOW = new Date("2026-10-15T15:00:00.000Z");
const DB = { tag: "service" } as never;
const ctx = { db: DB, now: NOW, origin: "https://app.example.com" } as never;
const row = (id: string, attempts = 0) => ({ id, account_id: "acc", document_id: "doc", storage_path: `acc/doc/${id}`, scan_attempts: attempts, created_at: "2026-10-15T14:59:00.000Z" });
const target = (id: string, attempts = 0) => ({ accountId: "acc", versionId: id, storagePath: `acc/doc/${id}`, attempts });
const FRESH = new Date(NOW.getTime() - 3_600_000).toISOString();
const ZERO = { scanned: 0, clean: 0, infected: 0, unscannable: 0, stillPending: 0, unreached: 0, failed: 0, deferred: 0, breaker: 0, notConfigured: 0 };

beforeEach(() => {
  for (const f of [listPendingScans, oldestPendingScanAt, recordHeartbeat, recordDocumentScan, scannerConfig, scannerHealth, scanVersion, spendScanError]) f.mockReset();
  recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 0 });
  scannerConfig.mockReturnValue({ origin: "https://s", secret: "x" });
  scannerHealth.mockResolvedValue({ ok: true, signaturesAt: FRESH });
  oldestPendingScanAt.mockResolvedValue(null);
  listPendingScans.mockResolvedValue([]);
  spendScanError.mockResolvedValue("pending");
});
afterEach(() => vi.restoreAllMocks());

describe("documentsScan, the retry pass (spec 3.4)", () => {
  it("not configured: no read, one failing heartbeat, its own counter (mutation: list anyway -> FAILS)", async () => {
    scannerConfig.mockReturnValue(null);
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, notConfigured: 1 });
    expect(listPendingScans).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "not configured (SCANNER_URL or SCANNER_SECRET unset)" });
  });

  it("scans every pending version oldest first with its own attempts, HOLDING clamd errors, counts each outcome, and beats ok (mutations: pass attempts 0 -> FAILS; scan without holdErrors -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b", 2), row("c")]);
    scanVersion.mockResolvedValueOnce("clean").mockResolvedValueOnce("unscannable").mockResolvedValueOnce("infected");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 3, clean: 1, unscannable: 1, infected: 1 });
    expect(listPendingScans).toHaveBeenCalledWith(DB, DOCUMENT_SCAN_BATCH);
    expect(scanVersion.mock.calls.map((c) => [c[1], c[3]])).toEqual([
      [target("a"), { holdErrors: true }], [target("b", 2), { holdErrors: true }], [target("c"), { holdErrors: true }]]);
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: true });
  });

  it("stamps each version TRIED before scanning it, so a version that always times out goes to the back of the line (re-review N2b; mutation: stamp after the scan -> the order FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b")]);
    scanVersion.mockResolvedValue("clean");
    await documentsScanPass.run(ctx);
    expect(recordDocumentScan.mock.calls.map((c) => [c[1].versionId, c[1].verdict])).toEqual([["a", "tried"], ["b", "tried"]]);
    expect(recordDocumentScan.mock.invocationCallOrder[0]!).toBeLessThan(scanVersion.mock.invocationCallOrder[0]!);
    expect(recordDocumentScan.mock.invocationCallOrder[1]!).toBeLessThan(scanVersion.mock.invocationCallOrder[1]!);
  });

  it("a version another scan finished first (its stamp answers stale) is skipped, not scanned (mutation: scan anyway -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a")]);
    recordDocumentScan.mockResolvedValueOnce({ status: "stale" });
    await documentsScanPass.run(ctx);
    expect(scanVersion).not.toHaveBeenCalled();
  });

  it("ONE pending file, ONE held error, and the self-test passes again after the loop: the error is spent (re-review N2a; mutation: never spend -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("b", 1)]);
    scanVersion.mockResolvedValueOnce("held");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 1, stillPending: 1 });
    expect(spendScanError).toHaveBeenCalledWith(DB, target("b", 1));
    expect(scannerHealth).toHaveBeenCalledTimes(2);
  });

  it("THE BREAKER with ONE pending file: the worker fails its self-test after the loop, so the held error is NOT spent and the heartbeat is red (re-review N2a; mutations: spend without the second self-test -> FAILS; the old count rule never trips on one file -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a", 2)]);
    scanVersion.mockResolvedValueOnce("held");
    scannerHealth.mockResolvedValueOnce({ ok: true, signaturesAt: FRESH }).mockResolvedValueOnce({ ok: false, reason: "self_test_failed" });
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 1, breaker: 1 });
    expect(spendScanError).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "the self-test failed after 1 file error; none were counted" });
  });

  it("a self-test that fails at the START scans nothing at all (mutation: scan when health is not ok -> FAILS)", async () => {
    scannerHealth.mockResolvedValue({ ok: false, reason: "self_test_failed" });
    listPendingScans.mockResolvedValue([row("a")]);
    expect(await documentsScanPass.run(ctx)).toEqual(ZERO);
    expect(scanVersion).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "worker self test failed" });
  });

  it("a misconfigured binding (every scan a 403: 'unreached') spends nothing and is named even for one file (plan review C1; mutation: count unreached as a verdict -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a", 2)]);
    scanVersion.mockResolvedValueOnce("unreached");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 1, unreached: 1 });
    expect(spendScanError).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "1 file could not be reached" });
  });

  it("a worker that is down scans NOTHING, so an outage never spends a file's attempts (plan deviation 7; mutation: scan anyway -> FAILS)", async () => {
    scannerHealth.mockResolvedValue({ ok: false, reason: "unreachable" });
    listPendingScans.mockResolvedValue([row("a")]);
    expect(await documentsScanPass.run(ctx)).toEqual(ZERO);
    expect(scanVersion).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "worker unreachable" });
  });

  it("one version that throws is counted, the others still scan, the heartbeat is written, then the pass throws (mutation: stop at the first throw -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b")]);
    scanVersion.mockRejectedValueOnce(new Error("storage down")).mockResolvedValueOnce("clean");
    await expect(documentsScanPass.run(ctx)).rejects.toThrow(/"failed":1/);
    expect(scanVersion).toHaveBeenCalledTimes(2);
    expect(recordHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("stops STARTING scans once one more could overrun its 45-second budget; the rest wait for the next tick (mutation: drop the budget check -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b"), row("c")]);
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    scanVersion.mockImplementation(async () => { clock += DOCUMENT_SCAN_BUDGET_MS - SCAN_TIMEOUT_MS + 1; return "clean"; });
    expect(await documentsScanPass.run(ctx)).toMatchObject({ scanned: 1, deferred: 2 });
  });
});

describe("scannerProblem: the heartbeat's words (spec 3.4; BIS staff read them in the ops email)", () => {
  it("names a stale signature set past 3 days and a file waiting past 15 minutes; nothing when healthy (mutations: 4 days -> FAILS; 10 minutes -> FAILS)", () => {
    const ok = { ok: true as const, signaturesAt: FRESH };
    expect(scannerProblem(ok, null, NOW)).toBeNull();
    expect(scannerProblem(ok, new Date(NOW.getTime() - 14 * 60_000).toISOString(), NOW)).toBeNull();
    expect(scannerProblem(ok, new Date(NOW.getTime() - 16 * 60_000).toISOString(), NOW)).toBe("a file has waited 16 minutes");
    expect(scannerProblem({ ok: true, signaturesAt: new Date(NOW.getTime() - 73 * 3_600_000).toISOString() }, null, NOW)).toBe("signatures 73 hours old");
    expect(scannerProblem({ ok: true, signaturesAt: new Date(NOW.getTime() - 71 * 3_600_000).toISOString() }, null, NOW)).toBeNull();
    expect(scannerProblem({ ok: false, reason: "clamd_down" }, new Date(NOW.getTime() - 20 * 60_000).toISOString(), NOW)).toBe("worker clamd down; a file has waited 20 minutes");
  });
});
