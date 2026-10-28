import type { PassContext } from "../context";

/**
 * F-196 — the one-off job runner's contract (spec section 8). Everything
 * under `lib/automations/jobs/` is scanned by `imports.test.ts` exactly as
 * the rest of `lib/automations` is: a job handler cannot reach a provider
 * factory of its own, and sends through `ctx.email`/`ctx.sms`, the gates
 * that honour `outbound_suppressed` and the billing pause.
 */

/** What a handler's `run` receives: the tick's own PassContext, plus the claimed row's identity. */
export type JobContext = PassContext & {
  job: {
    id: string;
    kind: string;
    attempt: number;
    maxAttempts: number;
    accountId: string | null;
    signal: AbortSignal;
  };
};

export type JobHandler<P> = {
  /** A dot-separated name, matched by 0102's own `jobs_kind_check` (see JOB_KIND_PATTERN below). */
  readonly kind: string;
  /** 1-25; stated by every handler, no default. */
  readonly maxAttempts: number;
  /** 1,000 to JOB_TIMEOUT_MAX_MS (60 s). */
  readonly timeoutMs: number;
  /** Default: 15 min doubling, capped at 24 h (DEFAULT_BACKOFF). */
  readonly backoff?: { baseMs: number; capMs: number };
  /** Throws -> dead at once: a payload that cannot parse never will. */
  parse(payload: unknown): P;
  /** Returns -> succeeded; throws -> retry (or dead, per the drain's rules). */
  run(ctx: JobContext, payload: P): Promise<void>;
};

/** Dead now, no retry (a 404 for a deleted calendar, say). */
export class PermanentJobError extends Error {}

/** Retry no sooner than afterMs (a Retry-After header read by the handler). Still subject to the backoff's cap. */
export class RetryJobAfter extends Error {
  constructor(
    readonly afterMs: number,
    message: string,
  ) {
    super(message);
  }
}

/** The ceiling every handler's own `timeoutMs` is bound by. */
export const JOB_TIMEOUT_MAX_MS = 60_000;

/** The app's own pre-check on `JSON.stringify(payload)`; 0102's CHECK on `octet_length(payload::text)` is mapped to the same refusal (Spec correction 5), since jsonb's rendered form is not a fixed ratio of the JSON's. */
export const JOB_PAYLOAD_MAX_BYTES = 8_192;

/** The twin of 0102's `jobs_kind_check` (`packages/db/supabase/migrations/0102_jobs.sql`), pinned equal by registry.test.ts. */
export const JOB_KIND_PATTERN = /^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$/;

/** 15 minutes doubling, capped at 24 hours — see backoff.ts. */
export const DEFAULT_BACKOFF = { baseMs: 15 * 60_000, capMs: 24 * 60 * 60_000 } as const;
