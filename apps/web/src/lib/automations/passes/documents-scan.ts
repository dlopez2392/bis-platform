import { listPendingScans, oldestPendingScanAt, recordDocumentScan, recordHeartbeat, listRequestsMissingReceivedTask } from "@bis/db";
import { scannerConfig, scannerHealth, SCAN_TIMEOUT_MS, SCANNER_HEARTBEAT_KEY, type ScannerHealth } from "@/lib/documents/scan-client";
import { scanVersion, spendScanError, type ScanTarget } from "@/lib/documents/scan-version";
import { SCAN_SLOW_MS } from "@/lib/documents/scan-state";
import { openRequestTask } from "@/lib/document-requests/request-task";
import type { Pass } from "../context";

/**
 * The document vault's virus scan, retried (spec 3.4). Not a recipe; it sends nothing. EVERY tick:
 * if the worker's /health is good, scan the ready versions still pending, oldest first (part 1's files
 * the first time: the catch-up), each through scanVersion (object first on a virus or unreadable
 * content). A down worker scans nothing (plan deviation 7).
 * Each version is stamped `tried` BEFORE it is scanned (re-review N2b), and the read orders never-tried
 * versions first, then the least recently tried: one that always times out can no longer sit at the head
 * and push every run past its start window.
 * THE BREAKER (re-review N2a, replacing plan review C1's count): countable errors (clamd's own, or an
 * object the app CONFIRMED missing; final check R2) are HELD during the loop and spent, one attempt each (the third
 * removes the file as unscannable, the generic note), ONLY when the worker's self-test passes AGAIN after
 * the loop. A worker-wide fault (out of memory, a broken signature set) fails the self-test, so nothing
 * is spent, even with one pending file. "unreached" (a 403 from a wrong binding, a network failure)
 * never spends.
 * Then ONE heartbeat, documents.scanner (0057): failing while the worker is not configured or
 * unreachable, clamd is down or fails its self-test, its signatures are over 3 days old, the breaker tripped, a pass with no
 * verdict could not reach a file, or a file has been pending over 15 minutes; the alert pass emails
 * on its first failure (lib/ops/watch.ts: not a cron.pass key) and /api/ops/health reports it.
 * A version whose scan threw (an object that would not delete) is counted and the pass THROWS after
 * the heartbeat, so cron.pass.documentsScan fails too.
 * BUDGET (orchestrator ruling: SCAN_TIMEOUT_MS is Task 5's committed 30_000, not the plan's 25_000):
 * no scan STARTS after 15 s (DOCUMENT_SCAN_BUDGET_MS, 45 s, minus the 30 s scan timeout), the health call
 * included. The spend loop (review fix 3) carries the SAME DOCUMENT_SCAN_BUDGET_MS cutoff, checked
 * before EVERY spend, including the first (coordinator fix round): past 45 s already-elapsed, NOTHING
 * is spent, not even one held error, because the check runs before each iteration of the loop, every
 * time, not only after it. A scan loop that itself ran long (a slow last scan), or the self-test
 * re-check that gates the spend loop (scannerHealth(), up to 5 s, runs BEFORE the spend loop's first
 * check), can leave every held error from this tick unspent, not only a later one; nothing is lost
 * — an unspent error stays pending, exactly like a deferred scan, and a later tick retries it.
 * Worst case, measured from the pass's start: the last scan started at 15 s ends by 45 s, and the
 * second self-test already runs before the spend loop's own check, so that check reads past the
 * budget on its very first iteration and nothing is spent; the oldest-pending read and the
 * heartbeat: a few seconds of round trips that no timeout bounds (supabase-js sets none), so about 50 s,
 * not 45. cron-coupling.test.ts asserts the budgets plus 60 s of headroom fit the route's 300 s
 * (60 + 60 + 60 + 45 + 60 = 285): the ~5 s overrun comes out of the 15 s left over and, past that, out
 * of the 60 s the test reserves for the unbudgeted passes. Plan review 6.
 * Every @bis/db export is dereferenced inside run(), never at module scope.
 * The lost-To-do reconcile (Task 6b, S-07 2b, plan review I5) runs FIRST, before the not-configured
 * early return: a request's clean customer file can predate a worker outage (or any crash between its
 * verdict and openRequestTask), and that file is already sitting in storage whether or not the scanner
 * is configured today. It does not touch the budgets above: it is bounded by COUNT, not time, but the
 * count is bigger than REQUEST_TASK_RECONCILE_LIMIT (20) alone suggests, because the reconcile's own
 * SEARCH can page before it ever reaches 20 To-dos: listRequestsMissingReceivedTask pages the clean-
 * customer-files side up to 40 times (its own guard), up to 500 files a page, and each page costs 1
 * read for the page itself plus 2 more (document_requests, tasks) per 100 request-id batch on that
 * page — a pathological backlog's worth of round trips before any To-do opens. Separately, inside the
 * scan loop below, scanVersion's afterClean hook (openReceivedTaskFor) runs after EVERY clean verdict
 * this tick produces, reconcile or not, each adding its own read (getDocumentRequestForVersion) and,
 * on a hit, openRequestTask's own reads and insert. None of this is time-budgeted; in the NORMAL case
 * — one short page, because the reconcile usually finds nothing stale past its first, often-empty,
 * page, and a tick's clean verdicts are few — it still sits well inside the spare around this budget:
 * in the in-process tick, what the budgeted passes leave of LEGACY_TICK_CEILING_S (300 s; the cron
 * route's own maxDuration until F-196); under fan-out, the 45 s this pass's own 90 s function
 * (`api/cron/pass/[key]/route.ts`) leaves past the budget. A
 * backlog that forces the full 40-page guard is the one case this spare does NOT cover; the guard's
 * own console.error names that call out for a human, not a timeout, rather than silently overrunning.
 */
export const DOCUMENT_SCAN_BUDGET_MS = 45_000;
export const DOCUMENT_SCAN_BATCH = 50;
export const SIGNATURES_MAX_AGE_MS = 3 * 86_400_000;
export const REQUEST_TASK_RECONCILE_LIMIT = 20;

export type PassOutcome = { failures: number; verdicts: number; unreached: number; breaker: boolean };
const QUIET: PassOutcome = { failures: 0, verdicts: 0, unreached: 0, breaker: false };

/** The heartbeat's words: plain English for BIS staff, never a URL, a token or a file name. */
export function scannerProblem(health: ScannerHealth, oldestPendingAt: string | null, now: Date, pass: PassOutcome = QUIET): string | null {
  const problems: string[] = [];
  if (!health.ok) {
    problems.push(health.reason === "not_configured" ? "not configured (SCANNER_URL or SCANNER_SECRET unset)" : `worker ${health.reason.replaceAll("_", " ")}`);
  } else {
    const age = now.getTime() - Date.parse(health.signaturesAt);
    if (age > SIGNATURES_MAX_AGE_MS) problems.push(`signatures ${Math.floor(age / 3_600_000)} hours old`);
  }
  if (pass.breaker) problems.push(`the self-test failed after ${pass.failures} file error${pass.failures === 1 ? "" : "s"}; none were counted`);
  else if (pass.verdicts === 0 && pass.unreached > 0) problems.push(`${pass.unreached} file${pass.unreached === 1 ? "" : "s"} could not be reached`);
  if (oldestPendingAt) {
    const waited = now.getTime() - Date.parse(oldestPendingAt);
    if (waited > SCAN_SLOW_MS) problems.push(`a file has waited ${Math.floor(waited / 60_000)} minutes`);
  }
  return problems.length > 0 ? problems.join("; ") : null;
}

type Counters = { scanned: number; clean: number; infected: number; unscannable: number; stillPending: number; unreached: number; failed: number; deferred: number; breaker: number; notConfigured: number; requestTasks: number };

/** Both exits of run() call this: the pass must throw for `failed > 0` whether the reconcile alone set it (not-configured exit) or the scan/spend loops did (the normal exit). */
function finish(c: Counters): Counters {
  if (c.failed > 0) throw new Error(`documents scan: ${JSON.stringify(c)}`);
  return c;
}

export const documentsScanPass: Pass = {
  key: "documentsScan",
  async run(ctx) {
    const c: Counters = { scanned: 0, clean: 0, infected: 0, unscannable: 0, stillPending: 0, unreached: 0, failed: 0, deferred: 0, breaker: 0, notConfigured: 0, requestTasks: 0 };
    // Plan review I5 (S-07 2b): a clean customer file whose request has no "received" To-do (a crash
    // between the verdict and openRequestTask, or a verdict that landed while the hook failed) gets it
    // now. Bounded by count; idempotent through tasks_document_request_once (0080).
    try {
      for (const request of await listRequestsMissingReceivedTask(ctx.db, ctx.now, REQUEST_TASK_RECONCILE_LIMIT)) {
        await openRequestTask(ctx.db, request.account_id, request, "received", ctx.now);
        c.requestTasks++;
      }
    } catch (e) {
      c.failed++;
      console.error(`documents scan: the request To-do reconcile failed: ${String(e)}`);
    }
    if (!scannerConfig()) {
      c.notConfigured = 1;
      await recordHeartbeat(ctx.db, SCANNER_HEARTBEAT_KEY, { ok: false, error: scannerProblem({ ok: false, reason: "not_configured" }, null, ctx.now)! });
      return finish(c);
    }
    const startedAt = Date.now();
    const health = await scannerHealth();
    const held: ScanTarget[] = [];
    if (health.ok) {
      const due = await listPendingScans(ctx.db, DOCUMENT_SCAN_BATCH);
      for (const [i, v] of due.entries()) {
        // Stop STARTING a scan once one more could overrun the budget (release-held.ts's shape).
        if (Date.now() - startedAt > DOCUMENT_SCAN_BUDGET_MS - SCAN_TIMEOUT_MS) { c.deferred = due.length - i; break; }
        try {
          // Stamp it tried first (re-review N2b): whatever happens next, it goes to the back of the line.
          // Its answer also carries the FRESH attempts count (review fix 5): the list read above can be
          // stale by the time the stamp lands — the finish action or a past tick's own scan can have
          // recorded an error in between — so scanVersion's own attempts>=3 shortcut reads the number
          // the stamp just confirmed, never the row's.
          const stamp = await recordDocumentScan(ctx.db, { accountId: v.account_id, versionId: v.id, verdict: "tried" });
          if (stamp.status === "stale") continue;
          // Counted only past the stale skip (review fix 5): a version another scan already finished
          // this tick was never actually scanned by this pass.
          c.scanned++;
          const target: ScanTarget = { accountId: v.account_id, versionId: v.id, storagePath: v.storage_path, attempts: stamp.attempts };
          const r = await scanVersion(ctx.db, target, undefined, { holdErrors: true, now: ctx.now });
          if (r === "clean") c.clean++;
          else if (r === "infected") c.infected++;
          else if (r === "unscannable") c.unscannable++;
          else if (r === "unreached") c.unreached++;
          else if (r === "held") held.push(target);
        } catch (e) {
          c.failed++;
          console.error(`documents scan: version ${v.id} (account ${v.account_id}): ${String(e)}`);
        }
      }
    }
    const verdicts = c.clean + c.infected + c.unscannable;
    const failures = held.length;
    // Re-review N2a: a held error is spent only if the worker can STILL scan a known-clean buffer now.
    const breaker = held.length > 0 && !(await scannerHealth()).ok;
    if (breaker) {
      c.breaker = 1;
    } else {
      for (const h of held) {
        // Review fix 3: the spend loop had no budget check of its own — up to every scan this tick's
        // worth of sequential round trips, past the scan loop's own cutoff. An unspent held error is
        // simply NOT recorded; the version stays pending (its scan_tried_at stamp already moved it to
        // the back of the line) and is picked up again next tick, exactly like a deferred scan.
        if (Date.now() - startedAt > DOCUMENT_SCAN_BUDGET_MS) break;
        try {
          const r = await spendScanError(ctx.db, h);
          if (r === "pending") c.stillPending++;
          else if (r === "unscannable") c.unscannable++;
        } catch (e) {
          c.failed++;
          console.error(`documents scan: version ${h.versionId} (account ${h.accountId}): ${String(e)}`);
        }
      }
    }
    const problem = scannerProblem(health, await oldestPendingScanAt(ctx.db), ctx.now, { failures, verdicts, unreached: c.unreached, breaker });
    await recordHeartbeat(ctx.db, SCANNER_HEARTBEAT_KEY, problem ? { ok: false, error: problem } : { ok: true });
    return finish(c);
  },
};
