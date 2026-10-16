import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listPendingScans = vi.fn();
const oldestPendingScanAt = vi.fn();
const recordHeartbeat = vi.fn();
const recordDocumentScan = vi.fn();
const listRequestsMissingReceivedTask = vi.fn();
vi.mock("@bis/db", () => ({
  listPendingScans: (...a: unknown[]) => listPendingScans(...a),
  oldestPendingScanAt: (...a: unknown[]) => oldestPendingScanAt(...a),
  recordHeartbeat: (...a: unknown[]) => recordHeartbeat(...a),
  recordDocumentScan: (...a: unknown[]) => recordDocumentScan(...a),
  listRequestsMissingReceivedTask: (...a: unknown[]) => listRequestsMissingReceivedTask(...a),
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
const openRequestTask = vi.fn();
vi.mock("@/lib/document-requests/request-task", () => ({
  openRequestTask: (...a: unknown[]) => openRequestTask(...a),
}));

const { documentsScanPass, scannerProblem, DOCUMENT_SCAN_BUDGET_MS, DOCUMENT_SCAN_BATCH, REQUEST_TASK_RECONCILE_LIMIT } = await import("./documents-scan");
const { SCAN_TIMEOUT_MS } = await import("@/lib/documents/scan-client");

const NOW = new Date("2026-10-15T15:00:00.000Z");
const DB = { tag: "service" } as never;
const ctx = { db: DB, now: NOW, origin: "https://app.example.com" } as never;
const row = (id: string, attempts = 0) => ({ id, account_id: "acc", document_id: "doc", storage_path: `acc/doc/${id}`, scan_attempts: attempts, created_at: "2026-10-15T14:59:00.000Z" });
const target = (id: string, attempts = 0) => ({ accountId: "acc", versionId: id, storagePath: `acc/doc/${id}`, attempts });
const reqRow = (id: string, accountId = "acc") => ({ id, account_id: accountId, contact_id: null, client_group_id: null, items: [], language: "en", channel: "email", created_by: "u", created_at: "2026-10-14T12:00:00.000Z", expires_at: "2026-10-21T12:00:00.000Z", revoked_at: null, revoked_by: null, completed_at: null, sent_at: null });
const FRESH = new Date(NOW.getTime() - 3_600_000).toISOString();
const ZERO = { scanned: 0, clean: 0, infected: 0, unscannable: 0, stillPending: 0, unreached: 0, failed: 0, deferred: 0, breaker: 0, notConfigured: 0, requestTasks: 0 };

beforeEach(() => {
  for (const f of [listPendingScans, oldestPendingScanAt, recordHeartbeat, recordDocumentScan, listRequestsMissingReceivedTask, scannerConfig, scannerHealth, scanVersion, spendScanError, openRequestTask]) f.mockReset();
  recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 0 });
  scannerConfig.mockReturnValue({ origin: "https://s", secret: "x" });
  scannerHealth.mockResolvedValue({ ok: true, signaturesAt: FRESH });
  oldestPendingScanAt.mockResolvedValue(null);
  listPendingScans.mockResolvedValue([]);
  listRequestsMissingReceivedTask.mockResolvedValue([]);
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

  it("the lost-To-do reconcile runs EVERY tick, even with the scanner not configured — a request's clean file may predate a worker outage (plan review I5; mutation: run it after the early return -> FAILS)", async () => {
    scannerConfig.mockReturnValue(null);
    const a = reqRow("req-a", "acc-a");
    const b = reqRow("req-b", "acc-b");
    listRequestsMissingReceivedTask.mockResolvedValue([a, b]);
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, notConfigured: 1, requestTasks: 2 });
    expect(openRequestTask).toHaveBeenCalledTimes(2);
    expect(openRequestTask).toHaveBeenNthCalledWith(1, DB, "acc-a", a, "received", NOW);
    expect(openRequestTask).toHaveBeenNthCalledWith(2, DB, "acc-b", b, "received", NOW);
  });

  it("the reconcile's read is bounded by REQUEST_TASK_RECONCILE_LIMIT, 20 (mutation: no limit -> FAILS)", async () => {
    await documentsScanPass.run(ctx);
    expect(REQUEST_TASK_RECONCILE_LIMIT).toBe(20);
    expect(listRequestsMissingReceivedTask).toHaveBeenCalledWith(DB, NOW, 20);
  });

  it("a reconcile read that throws is logged and counted as failed for the tick, and the scan still runs (mutation: let it abort the scan loop -> FAILS)", async () => {
    listRequestsMissingReceivedTask.mockRejectedValue(new Error("db down"));
    listPendingScans.mockResolvedValue([row("a")]);
    scanVersion.mockResolvedValue("clean");
    await expect(documentsScanPass.run(ctx)).rejects.toThrow(/"failed":1/);
    expect(scanVersion).toHaveBeenCalledTimes(1);
    expect(openRequestTask).not.toHaveBeenCalled();
  });

  it("a reconcile read that throws still THROWS on the not-configured exit, not just the configured one, and the not-configured heartbeat still goes out (review gap; mutation: bare 'return c' in the not-configured branch -> FAILS)", async () => {
    scannerConfig.mockReturnValue(null);
    listRequestsMissingReceivedTask.mockRejectedValue(new Error("db down"));
    await expect(documentsScanPass.run(ctx)).rejects.toThrow(/"failed":1/);
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "not configured (SCANNER_URL or SCANNER_SECRET unset)" });
  });

  it("scans every pending version oldest first with the TRIED stamp's own fresh attempts, HOLDING clamd errors, counts each outcome, and beats ok (mutations: pass attempts 0 -> FAILS; scan without holdErrors -> FAILS; read v.scan_attempts instead of the stamp's answer -> FAILS)", async () => {
    // Review fix 5: the fresh attempts count comes from the tried stamp's own answer, not the
    // (possibly stale) row read — "b" is mocked to answer 2 regardless of row("b", 2)'s own field.
    recordDocumentScan.mockImplementation(async (_db: unknown, a: { versionId: string }) => ({ status: "ok", attempts: a.versionId === "b" ? 2 : 0 }));
    listPendingScans.mockResolvedValue([row("a", 9), row("b", 9), row("c", 9)]);
    scanVersion.mockResolvedValueOnce("clean").mockResolvedValueOnce("unscannable").mockResolvedValueOnce("infected");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 3, clean: 1, unscannable: 1, infected: 1 });
    expect(listPendingScans).toHaveBeenCalledWith(DB, DOCUMENT_SCAN_BATCH);
    // Plan review M2: `now: ctx.now` rides alongside `holdErrors` so scanVersion's afterClean hook
    // (the request To-do it opens on a clean customer file) stamps with the TICK's clock, never `new Date()`.
    expect(scanVersion.mock.calls.map((c) => [c[1], c[3]])).toEqual([
      [target("a"), { holdErrors: true, now: NOW }], [target("b", 2), { holdErrors: true, now: NOW }], [target("c"), { holdErrors: true, now: NOW }]]);
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

  it("a version another scan finished first (its stamp answers stale) is skipped, not scanned, and not COUNTED scanned either (review fix 5; mutation: scan anyway -> FAILS; count it before the stale check -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a")]);
    recordDocumentScan.mockResolvedValueOnce({ status: "stale" });
    expect(await documentsScanPass.run(ctx)).toEqual(ZERO);
    expect(scanVersion).not.toHaveBeenCalled();
  });

  it("ONE pending file, ONE held error, and the self-test passes again after the loop: the error is spent (re-review N2a; mutation: never spend -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: 1 });
    listPendingScans.mockResolvedValue([row("b", 9)]);
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

  // Review fix 3: the spend loop had no budget check of its own. Two held errors; the first spend
  // pushes elapsed time past DOCUMENT_SCAN_BUDGET_MS, so the second is never attempted this tick (it
  // simply retries next tick, exactly like a deferred scan).
  it("stops SPENDING held errors once the 45-second budget is used up; the rest are left pending, unspent, for the next tick (review fix 3; mutation: drop the spend-loop budget check -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b")]);
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    scanVersion.mockResolvedValue("held");
    spendScanError.mockImplementation(async () => { clock += DOCUMENT_SCAN_BUDGET_MS + 1; return "pending"; });
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 2, stillPending: 1 });
    expect(spendScanError).toHaveBeenCalledTimes(1);
  });
});

describe("documentsScan pass: the heartbeat reads the REAL oldestPendingScanAt and the REAL verdict mix each tick (review fix 1, 2)", () => {
  it("a file waiting 16 minutes fails the heartbeat even with nothing listed this tick (review fix 1; mutation: hardcode null instead of awaiting oldestPendingScanAt -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([]);
    oldestPendingScanAt.mockResolvedValue(new Date(NOW.getTime() - 16 * 60_000).toISOString());
    expect(await documentsScanPass.run(ctx)).toEqual(ZERO);
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "a file has waited 16 minutes" });
  });

  it("one clean verdict alongside one unreached file still beats ok — 'could not be reached' names only a tick with NO successful verdict (review fix 2; mutation: drop the verdicts === 0 guard -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b")]);
    scanVersion.mockResolvedValueOnce("clean").mockResolvedValueOnce("unreached");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 2, clean: 1, unreached: 1 });
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: true });
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
