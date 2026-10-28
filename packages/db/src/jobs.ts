import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * F-196: the background job queue (migration 0102, `public.jobs`). One-off,
 * retryable work claimed with `claim_jobs` (`for update skip locked`,
 * leases, dead-letter on a run-out last attempt) and swept with
 * `sweep_jobs` (retention). service_role only — the table grants anon and
 * authenticated nothing, so every caller passes `serviceDb()`.
 *
 * Every writer below that finishes a running row (`completeJob`,
 * `retryJob`, `killJob`) is fenced by the claim token AND `state =
 * "running"`: a write naming a stale or wrong token touches no row, so a
 * worker whose lease has already been reclaimed by `claim_jobs` can never
 * clobber the next worker's progress by finishing late.
 */

export type JobState = "queued" | "running" | "retrying" | "succeeded" | "dead";

export type JobRow = {
  id: string; kind: string; account_id: string | null; idempotency_key: string; payload: unknown;
  state: JobState; run_after: string; attempts: number; max_attempts: number; timeout_ms: number;
  claim_token: string | null; lease_until: string | null; last_error: string | null;
  created_at: string; updated_at: string; finished_at: string | null;
};

export type NewJob = {
  kind: string; accountId: string | null; idempotencyKey: string; payload: unknown;
  runAfter: string; maxAttempts: number; timeoutMs: number;
};

export type JobFence = { id: string; claimToken: string };

/** The most `last_error` holds (0102's `jobs_last_error_check`); the same shape as `boundHeartbeatError` (ops.ts). */
export const JOB_ERROR_MAX_CHARS = 300;

/**
 * What is sent as a job's `last_error`. NUL is dropped first (Postgres text
 * cannot hold it, and a `\u0000` would fail the whole RPC/PostgREST call
 * rather than just losing the error text), then cut by CODE POINT so an
 * astral character sitting at the 300-character boundary is never split
 * into a lone surrogate (`String.prototype.slice` counts UTF-16 units and
 * would).
 */
export function boundJobError(error: string): string {
  return Array.from(error.replace(/\u0000/g, "")).slice(0, JOB_ERROR_MAX_CHARS).join("");
}

/**
 * The one refusal for an oversize payload — raised here when `insertJob`
 * maps 0102's `jobs_payload_size_check` (a 23514 naming it), and raised the
 * same way by `enqueue()`'s own pre-check on `JSON.stringify`, because no
 * fixed ratio bounds jsonb's own rendering by `JSON.stringify`'s byte count
 * (a bare `1e300` is 6 bytes of JSON and far more once stored as jsonb
 * text, since Postgres prints the number in full).
 */
export class JobPayloadTooLarge extends Error {}

function payloadTooLarge(error: { code?: string; message: string }): boolean {
  return error.code === "23514" && error.message.includes("jobs_payload_size_check");
}

/**
 * Inserts a job, or — on the per-(kind, account, key) unique key — reads
 * back the job that already holds it, so a caller can tell a dead
 * duplicate (`state: "dead"`) from a live one without a round trip of its
 * own. The read-back is scoped to the SAME account as the attempted
 * insert (a platform job, `accountId: null`, and an account's job never
 * share a row even under the identical kind and key): `insertJob` throws
 * if no row answers, since a reported 23505 with nothing to read back is
 * not a race this caller can resolve.
 *
 * Throws `JobPayloadTooLarge` for a payload 0102's own CHECK refuses;
 * throws plainly (naming the failing call) on any other PostgREST error.
 */
export async function insertJob(db: SupabaseClient, job: NewJob): Promise<{ id: string; created: boolean; state: JobState }> {
  const { data, error } = await db.from("jobs").insert({
    kind: job.kind, account_id: job.accountId, idempotency_key: job.idempotencyKey, payload: job.payload,
    run_after: job.runAfter, max_attempts: job.maxAttempts, timeout_ms: job.timeoutMs,
  }).select("id, state").single();
  if (error) {
    if (payloadTooLarge(error)) throw new JobPayloadTooLarge("the job's payload is over 8 KB");
    if (error.code === "23505") {
      const scoped = db.from("jobs").select("id, state").eq("kind", job.kind).eq("idempotency_key", job.idempotencyKey);
      const { data: existing, error: readError } = await (
        job.accountId === null ? scoped.is("account_id", null) : scoped.eq("account_id", job.accountId)
      ).maybeSingle();
      if (readError) throw new Error(`insertJob failed: ${readError.message}`);
      if (!existing) throw new Error("insertJob: a duplicate key was reported but the existing row could not be read back");
      const row = existing as { id: string; state: JobState };
      return { id: row.id, created: false, state: row.state };
    }
    throw new Error(`insertJob failed: ${error.message}`);
  }
  const row = data as { id: string; state: JobState };
  return { id: row.id, created: true, state: row.state };
}

/** One claim through 0102's `claim_jobs`: `for update skip locked`, a lease, a dead-letter on a run-out last attempt. Empty `kinds` short-circuits to no call. */
export async function claimJob(db: SupabaseClient, kinds: readonly string[]): Promise<JobRow | null> {
  if (kinds.length === 0) return null;
  const { data, error } = await db.rpc("claim_jobs", { p_kinds: [...kinds], p_limit: 1 });
  if (error) throw new Error(`claimJob failed: ${error.message}`);
  const rows = (data ?? []) as JobRow[];
  return rows[0] ?? null;
}

/** The compare-and-set shared by the three finishers: only a row still `running` under THIS fence's token is touched. */
async function finishRunningJob(db: SupabaseClient, fence: JobFence, patch: Record<string, unknown>, what: string): Promise<boolean> {
  const { data, error } = await db.from("jobs").update(patch)
    .eq("id", fence.id).eq("claim_token", fence.claimToken).eq("state", "running")
    .select("id");
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** A job finished clean. False when the fence no longer holds the row (another worker already finished or reclaimed it). */
export async function completeJob(db: SupabaseClient, fence: JobFence, atIso: string): Promise<boolean> {
  return finishRunningJob(db, fence, {
    state: "succeeded", finished_at: atIso, lease_until: null, claim_token: null, updated_at: atIso,
  }, "completeJob");
}

/** A job that failed but may run again: moves `run_after` out, records the (bounded) error, and releases the lease. */
export async function retryJob(db: SupabaseClient, fence: JobFence, runAfterIso: string, error: string, atIso: string): Promise<boolean> {
  return finishRunningJob(db, fence, {
    state: "retrying", run_after: runAfterIso, last_error: boundJobError(error), lease_until: null, claim_token: null, updated_at: atIso,
  }, "retryJob");
}

/** A job given up on for good: dead-lettered with the (bounded) error and `finished_at` set. */
export async function killJob(db: SupabaseClient, fence: JobFence, error: string, atIso: string): Promise<boolean> {
  return finishRunningJob(db, fence, {
    state: "dead", finished_at: atIso, last_error: boundJobError(error), lease_until: null, claim_token: null, updated_at: atIso,
  }, "killJob");
}

/** Retention, through 0102's `sweep_jobs`: deletes old `succeeded`/`dead` rows, oldest first, up to `limit`. */
export async function sweepJobs(db: SupabaseClient, limit: number): Promise<number> {
  const { data, error } = await db.rpc("sweep_jobs", { p_limit: limit });
  if (error) throw new Error(`sweepJobs failed: ${error.message}`);
  return Number(data);
}

/**
 * How many dead-lettered jobs sit under each kind right now (ops-watch's
 * backlog signal). 0102 carries no count-by-kind RPC, so this reads at
 * most `DEAD_JOB_COUNT_CAP` unordered rows and groups them in TS: past
 * that cap a per-kind count would silently go wrong (more dead rows exist
 * than were read), so hitting the cap is reported explicitly as
 * `truncated: true` rather than folded into a number that looks exact.
 * A caller that alerts on `counts` should say "<cap> or more" when
 * `truncated` is true, never a bare count.
 */
export const DEAD_JOB_COUNT_CAP = 1000;

export type DeadJobCounts = { counts: Record<string, number>; truncated: boolean };

export async function deadJobCounts(db: SupabaseClient): Promise<DeadJobCounts> {
  const { data, error } = await db.from("jobs").select("kind").eq("state", "dead").limit(DEAD_JOB_COUNT_CAP);
  if (error) throw new Error(`deadJobCounts failed: ${error.message}`);
  const rows = (data ?? []) as { kind: string }[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  return { counts, truncated: rows.length >= DEAD_JOB_COUNT_CAP };
}

/** The earliest due `queued`/`retrying` row across the whole table, as of `nowIso` — or null when nothing is due yet. */
export async function oldestDueJob(db: SupabaseClient, nowIso: string): Promise<{ kind: string; runAfter: string } | null> {
  const { data, error } = await db.from("jobs").select("kind, run_after")
    .in("state", ["queued", "retrying"]).lte("run_after", nowIso)
    .order("run_after", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`oldestDueJob failed: ${error.message}`);
  if (!data) return null;
  const row = data as { kind: string; run_after: string };
  return { kind: row.kind, runAfter: row.run_after };
}
