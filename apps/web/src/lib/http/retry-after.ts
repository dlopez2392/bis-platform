/**
 * F-196 Q4: the bound on one provider send, shared by the email (Resend) and
 * SMS (Telnyx) providers. A send is at most attempt + wait + attempt:
 * 2 x SEND_TIMEOUT_MS + RATE_LIMIT_MAX_WAIT_MS = 23 s. Under fan-out the row
 * in flight has to end inside the 90 s pass route, and the cron coupling test
 * pins `max budget + 2 x SEND_TIMEOUT_MS + RATE_LIMIT_MAX_WAIT_MS + 5 s <= 90 s`
 * from these constants. Change one and that test says whether it still fits.
 *
 * Deliberately neutral (`lib/http`, not `lib/email` or `lib/sms`): both
 * providers import it, and it imports nothing.
 */

/** One provider attempt. Outbound sends must not hold a webhook or a pass open
 *  (it was `lib/sms/telnyx.ts`'s own constant before it was shared). */
export const SEND_TIMEOUT_MS = 10_000;

/** No `Retry-After`, or one we cannot read. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 1_000;

/** A longer ask is not waited for: the send fails now, its row stays
 *  unstamped, and the next tick retries it. */
export const RATE_LIMIT_MAX_WAIT_MS = 3_000;

/**
 * How long to wait before the one retry a 429 earns, from its `Retry-After`
 * (RFC 9110 §10.2.3: delta-seconds or an HTTP-date). A date already past is
 * 0. Anything unreadable is the default. `null` means the wait exceeds
 * RATE_LIMIT_MAX_WAIT_MS: do not retry.
 */
export function rateLimitWaitMs(header: string | null | undefined, nowMs: number): number | null {
  const value = header?.trim() ?? "";
  let ms = RATE_LIMIT_DEFAULT_WAIT_MS;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1_000;
  } else if (value) {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) ms = Math.max(0, at - nowMs);
  }
  return ms > RATE_LIMIT_MAX_WAIT_MS ? null : ms;
}

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
