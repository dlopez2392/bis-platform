import { serviceDb, insertJob, JobPayloadTooLarge, type JobState, type SupabaseClient } from "@bis/db";
import { JOB_HANDLERS, type JobKind, type JobPayload } from "./registry";
import { JOB_PAYLOAD_MAX_BYTES, type JobHandler } from "./types";

/**
 * The one door into the jobs table (server-only; `jobs` is service-only).
 * Copies `maxAttempts` and `timeoutMs` off the handler onto the row, so a
 * claim never needs the registry to know what it is bound by. Refuses an
 * oversize payload before the insert even runs, and `insertJob` maps
 * 0102's own payload CHECK to the same refusal (Spec correction 5), so
 * either path answers the same class.
 *
 * `accountId` is required, null included, so every caller decides it.
 * `enqueue` checks nothing about who asked — that is the caller's job,
 * before this is reached.
 */
export async function enqueue<K extends JobKind>(
  kind: K,
  payload: JobPayload<K>,
  opts: { idempotencyKey: string; accountId: string | null; runAfter?: Date; db?: SupabaseClient },
): Promise<{ id: string; created: boolean; state: JobState }> {
  const handler = (JOB_HANDLERS as Record<string, JobHandler<unknown> | undefined>)[kind];
  if (!handler) throw new Error(`enqueue: unknown job kind "${String(kind)}"`);
  if (opts.idempotencyKey.length < 1 || opts.idempotencyKey.length > 200) {
    throw new Error("enqueue: idempotencyKey must be 1 to 200 characters");
  }
  if (Buffer.byteLength(JSON.stringify(payload)) > JOB_PAYLOAD_MAX_BYTES) {
    throw new JobPayloadTooLarge("the job's payload is over 8 KB");
  }
  return insertJob(opts.db ?? serviceDb(), {
    kind,
    accountId: opts.accountId,
    idempotencyKey: opts.idempotencyKey,
    payload,
    runAfter: (opts.runAfter ?? new Date()).toISOString(),
    maxAttempts: handler.maxAttempts,
    timeoutMs: handler.timeoutMs,
  });
}
