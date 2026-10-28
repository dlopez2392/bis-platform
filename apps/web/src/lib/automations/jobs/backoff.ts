import { DEFAULT_BACKOFF } from "./types";

/**
 * Spec section 8's backoff: after failed attempt n, wait
 * `min(base * 2^(n-1), cap)` with +/-20% jitter; a `retryAfterMs` (read by
 * the handler from something like a Retry-After header) replaces the
 * computed wait but is still subject to the same cap. With the default
 * base and five attempts, retries land about 15 min, 30 min, 1 h and 2 h
 * apart, and the job is dead after about four hours of failing.
 */
export function nextRunAfter(input: {
  /** The attempt that just failed, 1-based. */
  attempt: number;
  now: Date;
  backoff?: { baseMs: number; capMs: number };
  /** From RetryJobAfter, when the handler read one. */
  retryAfterMs?: number;
  /** [0, 1); default Math.random. */
  random?: () => number;
}): Date {
  const { baseMs, capMs } = input.backoff ?? DEFAULT_BACKOFF;
  const random = input.random ?? Math.random;
  const wait = input.retryAfterMs ?? baseMs * 2 ** (input.attempt - 1);
  const jittered = wait * (0.8 + 0.4 * random());
  const finalMs = Math.min(jittered, capMs);
  return new Date(input.now.getTime() + finalMs);
}
