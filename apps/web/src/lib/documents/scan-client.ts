import { createHmac } from "node:crypto";

/**
 * The app's side of the document vault's scanner (spec 3.1, 3.4; services/scanner). Two calls, each
 * signed with this deployment's SCANNER_SECRET over `${timestamp}.${METHOD}.${path}.${body}` (the
 * worker's own canonical string, services/scanner/src/hmac.mjs; both tests pin one vector). SERVER
 * ONLY. Neither call ever throws: every failure is an error verdict or an unhealthy answer, so a down
 * worker leaves files Checking (owner decision P3), never open. SCANNER_URL must be https, except on
 * loopback for the e2e stack (apps/web/playwright.config.ts).
 * Plan review C1; final check R2 (orchestrator ruling): an error carries its CAUSE. "clamd": the worker
 * answered a well-formed 200 saying clamd failed on this stream. "missing": the worker says storage
 * reported THIS object not found; scanVersion re-checks that itself with the service-role client and
 * counts it only when the object is confirmed gone. Everything else (a non-200 from the worker such as
 * a 401/403 from a misconfigured binding, stage "transport", a network failure, junk) is "transport"
 * and never counts. Even a countable error is only HELD by scanVersion; the retry pass spends it after
 * the worker's self-test passes again in the same run (re-review N2a), and the finish never spends one.
 *
 * Orchestrator ruling (overrides the plan's 25_000): SCAN_TIMEOUT_MS is the worker's own 25s scan
 * budget plus network headroom, so it is 30_000.
 */
export const SCAN_TIMEOUT_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 5_000;
/** The heartbeat the retry pass writes and /api/ops/health reads (0057's ops_heartbeats; not a cron.pass key). */
export const SCANNER_HEARTBEAT_KEY = "documents.scanner";

export type ScanVerdict =
  | { verdict: "clean" }
  | { verdict: "infected"; signature: string }
  | { verdict: "unscannable"; signature: string }
  | { verdict: "error"; cause: "clamd" | "missing" | "transport" };
export type ScannerConfig = { origin: string; secret: string };
export type ScannerHealth = { ok: true; signaturesAt: string } | { ok: false; reason: "not_configured" | "unreachable" | "clamd_down" | "self_test_failed" | "bad_answer" };
export type ScanClientDeps = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; nowSeconds?: () => number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const NOT_SPENT: ScanVerdict = { verdict: "error", cause: "transport" };

export function scannerConfig(env: Record<string, string | undefined> = process.env): ScannerConfig | null {
  const raw = env.SCANNER_URL?.trim();
  const secret = env.SCANNER_SECRET?.trim();
  if (!raw || !secret) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && loopback))) return null;
  return { origin: u.origin, secret };
}

export function scanSignature(secret: string, timestamp: number, method: "GET" | "POST", path: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${method}.${path}.${body}`).digest("hex");
}

async function call(cfg: ScannerConfig, method: "GET" | "POST", path: string, body: string, d: ScanClientDeps, timeoutMs: number): Promise<Response> {
  const ts = (d.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  return (d.fetchImpl ?? fetch)(`${cfg.origin}${path}`, {
    method, body: method === "POST" ? body : undefined, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": scanSignature(cfg.secret, ts, method, path, body) },
  });
}

/** Asks the worker to scan ONE signed object URL. Never throws; anything but a well-formed verdict is an unspent error. */
export async function requestScan(objectUrl: string, d: ScanClientDeps = {}): Promise<ScanVerdict> {
  const cfg = scannerConfig(d.env ?? process.env);
  if (!cfg) return NOT_SPENT;
  try {
    const res = await call(cfg, "POST", "/scan", JSON.stringify({ url: objectUrl }), d, SCAN_TIMEOUT_MS);
    if (res.status !== 200) return NOT_SPENT;
    const body: unknown = await res.json();
    if (!isObj(body)) return NOT_SPENT;
    if (body.verdict === "clean") return { verdict: "clean" };
    const name = typeof body.signature === "string" ? body.signature.trim().slice(0, 200) : "";
    if ((body.verdict === "infected" || body.verdict === "unscannable") && name !== "") return { verdict: body.verdict, signature: name };
    if (body.verdict === "error" && (body.stage === "clamd" || body.stage === "missing")) return { verdict: "error", cause: body.stage };
    return NOT_SPENT;
  } catch {
    return NOT_SPENT;
  }
}

/** The worker's /health, its INSTREAM self-test included (re-review N2a): ok only when clamd scanned the fixed clean buffer clean. Never throws. */
export async function scannerHealth(d: ScanClientDeps = {}): Promise<ScannerHealth> {
  const cfg = scannerConfig(d.env ?? process.env);
  if (!cfg) return { ok: false, reason: "not_configured" };
  try {
    const res = await call(cfg, "GET", "/health", "", d, HEALTH_TIMEOUT_MS);
    if (res.status !== 200) return { ok: false, reason: "unreachable" };
    const body: unknown = await res.json();
    if (!isObj(body)) return { ok: false, reason: "bad_answer" };
    if (body.clamd !== true) return { ok: false, reason: "clamd_down" };
    if (body.selfTest !== true) return { ok: false, reason: "self_test_failed" };
    if (typeof body.signaturesAt !== "string" || Number.isNaN(Date.parse(body.signaturesAt))) return { ok: false, reason: "bad_answer" };
    return { ok: true, signaturesAt: body.signaturesAt };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
