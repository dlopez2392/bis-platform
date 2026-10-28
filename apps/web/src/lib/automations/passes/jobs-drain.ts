import {
  claimJob, completeJob, retryJob, killJob, sweepJobs, deadJobCounts, oldestDueJob, recordHeartbeat,
  DEAD_JOB_COUNT_CAP, type JobFence, type JobRow, type SupabaseClient,
} from "@bis/db";
import type { Pass, PassContext, PassCounters } from "../context";
import type { HeartbeatOutcome } from "../harness";
import { nextRunAfter } from "../jobs/backoff";
import { JOB_HANDLERS } from "../jobs/registry";
import { JOB_TIMEOUT_MAX_MS, PermanentJobError, RetryJobAfter, type JobHandler } from "../jobs/types";

/**
 * F-196 — the jobs drain (spec section 9), one node of the fan-out plan with
 * its own 300 s route (`app/api/cron/pass/jobsDrain`). Per tick it claims
 * due jobs one at a time and runs each under the row's own timeout:
 *  - every finisher (complete, retry, kill) is fenced by the claim token, so
 *    a worker whose lease was reclaimed can never finish the next worker's
 *    run; a finisher that finds its fence gone counts `vanished`;
 *  - a throw retries on backoff.ts's curve (a RetryJobAfter's wait replaces
 *    it), and is dead-lettered on PermanentJobError or when the ROW's
 *    `max_attempts` (copied off the handler at enqueue) is spent;
 *  - a payload that cannot parse is dead at once, with fixed text: a parse
 *    error may quote the payload, and `last_error` is read by people;
 *  - a job is started only when the job ceiling still fits the budget, so the
 *    one in flight ends by JOBS_DRAIN_BUDGET_MS, and never more than
 *    JOBS_PER_DRAIN claims.
 * After the loop: the retention sweep, then the queue's two heartbeats
 * (`jobs.dead`, `jobs.backlog`), which ops-watch alerts on at the first
 * failure. A sweep that throws is rethrown only after both are written, so
 * the harness records `cron.pass.jobsDrain` failed without losing them.
 */

/** Spec section 9 said 240 s; lowered under Node fetch's 300 s headers timeout (ASSUMPTION), so the dispatcher hears the answer. */
export const JOBS_DRAIN_BUDGET_MS = 200_000;
export const JOBS_PER_DRAIN = 100;
export const JOBS_SWEEP_LIMIT = 500;
export const JOBS_BACKLOG_ALERT_MS = 60 * 60_000;
export const JOBS_DEAD_KEY = "jobs.dead";
export const JOBS_BACKLOG_KEY = "jobs.backlog";

export type DrainDeps = {
  handlers: Readonly<Record<string, JobHandler<unknown>>>;
  /** Wall clock for the budget and bookkeeping timestamps; handlers read ctx.now. */
  clock: () => number;
  random: () => number;
  /** Default recordHeartbeat, which never throws. */
  beat: (db: SupabaseClient, key: string, outcome: HeartbeatOutcome) => Promise<void>;
};

const PAYLOAD_UNREADABLE = "the job's payload could not be read";
const NO_HANDLER = "no handler is registered for this job's kind";

type Finish = "succeeded" | "retried" | "dead" | "vanished";

export function makeJobsDrainPass(deps: Partial<DrainDeps> = {}): Pass {
  const handlers = deps.handlers ?? (JOB_HANDLERS as Readonly<Record<string, JobHandler<unknown>>>);
  const clock = deps.clock ?? Date.now;
  const random = deps.random ?? Math.random;
  const beat = deps.beat ?? recordHeartbeat;

  return {
    key: "jobsDrain",
    async run(ctx: PassContext): Promise<PassCounters> {
      const { db } = ctx;
      const kinds = Object.keys(handlers);
      const counters: PassCounters = {
        claimed: 0, succeeded: 0, retried: 0, dead: 0, vanished: 0, notStartedBudget: 0,
      };
      const startedAt = clock();

      while (counters.claimed! < JOBS_PER_DRAIN) {
        if (clock() - startedAt + JOB_TIMEOUT_MAX_MS > JOBS_DRAIN_BUDGET_MS) {
          counters.notStartedBudget = 1;
          break;
        }
        const job = await claimJob(db, kinds);   // a throw rejects the pass: the harness records it
        if (!job) break;
        counters.claimed! += 1;
        counters[await runOne(ctx, job, handlers[job.kind], clock, random)]! += 1;
      }

      let sweepError: unknown = null;
      try {
        counters.swept = await sweepJobs(db, JOBS_SWEEP_LIMIT);
      } catch (e) {
        sweepError = e;
      }

      try {
        await beat(db, JOBS_DEAD_KEY, deadOutcome(await deadJobCounts(db)));
      } catch (e) {
        console.error(`jobs drain: ${JOBS_DEAD_KEY} not written, the dead-job read failed: ${errorText(e)}`);
      }

      try {
        const oldest = await oldestDueJob(db, new Date(clock()).toISOString());
        const waitMs = oldest ? Math.max(0, clock() - Date.parse(oldest.runAfter)) : 0;
        counters.oldestWaitMinutes = Math.floor(waitMs / 60_000);
        await beat(db, JOBS_BACKLOG_KEY, oldest && waitMs > JOBS_BACKLOG_ALERT_MS
          ? { ok: false, error: `the oldest waiting job (${oldest.kind}) has waited ${counters.oldestWaitMinutes} minutes` }
          : { ok: true });
      } catch (e) {
        // Not measured, so not reported: no oldestWaitMinutes rather than a 0 that reads as an empty queue.
        delete counters.oldestWaitMinutes;
        console.error(`jobs drain: ${JOBS_BACKLOG_KEY} not written, the backlog read failed: ${errorText(e)}`);
      }

      if (sweepError !== null) {
        // The rethrow replaces these counters with { errored: 1 } in the cron's JSON; log them first.
        console.error(`jobs drain: the sweep failed after this drain's work ${JSON.stringify(counters)}`);
        throw sweepError;
      }
      return counters;
    },
  };
}

export const jobsDrainPass: Pass = makeJobsDrainPass();

/** One claimed job, start to finish; answers which counter it lands in. */
async function runOne(
  ctx: PassContext, job: JobRow, handler: JobHandler<unknown> | undefined,
  clock: () => number, random: () => number,
): Promise<Finish> {
  const fence: JobFence = { id: job.id, claimToken: job.claim_token! };
  const at = () => new Date(clock()).toISOString();

  const fail = async (e: unknown, backoff: JobHandler<unknown>["backoff"]): Promise<Finish> => {
    const message = errorText(e);
    if (e instanceof PermanentJobError || job.attempts >= job.max_attempts) {
      return (await killJob(ctx.db, fence, message, at())) ? "dead" : "vanished";
    }
    const runAfter = nextRunAfter({
      attempt: job.attempts, now: new Date(clock()), backoff,
      retryAfterMs: e instanceof RetryJobAfter ? e.afterMs : undefined, random,
    });
    return (await retryJob(ctx.db, fence, runAfter.toISOString(), message, at())) ? "retried" : "vanished";
  };

  // claimJob is asked only for the map's own kinds, so this is a deploy
  // changing the map under a claim: a failure like any other, retried.
  if (!handler) return fail(new Error(NO_HANDLER), undefined);

  let payload: unknown;
  try {
    payload = handler.parse(job.payload);
  } catch {
    return (await killJob(ctx.db, fence, PAYLOAD_UNREADABLE, at())) ? "dead" : "vanished";
  }

  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new Error(`the job ran past its timeout (${job.timeout_ms} ms)`));
    }, job.timeout_ms);
  });
  try {
    await Promise.race([
      (async () => handler.run({
        ...ctx,
        job: {
          id: job.id, kind: job.kind, attempt: job.attempts, maxAttempts: job.max_attempts,
          accountId: job.account_id, signal: ac.signal,
        },
      }, payload))(),
      timedOut,
    ]);
  } catch (e) {
    return fail(e, handler.backoff);
  } finally {
    clearTimeout(timer);
  }
  return (await completeJob(ctx.db, fence, at())) ? "succeeded" : "vanished";
}

/** `jobs.dead`: ok with none; else each kind with its count, by kind. Past the read's cap, never a bare total. */
function deadOutcome({ counts, truncated }: { counts: Record<string, number>; truncated: boolean }): HeartbeatOutcome {
  const kinds = Object.keys(counts).sort();
  if (kinds.length === 0) return { ok: true };
  const list = kinds.map((k) => `${k} (${counts[k]})`).join(", ");
  if (truncated) return { ok: false, error: `${DEAD_JOB_COUNT_CAP} or more jobs gave up, among them: ${list}` };
  const total = kinds.reduce((n, k) => n + counts[k]!, 0);
  return { ok: false, error: `${total} job${total === 1 ? "" : "s"} gave up: ${list}` };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
