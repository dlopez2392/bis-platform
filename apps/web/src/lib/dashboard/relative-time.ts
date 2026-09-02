// apps/web/src/lib/dashboard/relative-time.ts
//
// "10m" / "3h" / "2d" — the activity feed's per-row timestamp (Task 7).
// Purely instant-to-instant arithmetic (epoch milliseconds in, a bucket
// label out) — no Intl, no timezone, unlike every OTHER date helper in this
// directory (day-label.ts, greeting.ts, metrics.ts all read the account's
// zone). "10 minutes ago" is the same fact in every zone; there is nothing
// here for the recorded Americas-previous-day class of bug to hide in.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * `createdAtIso` is the event's own timestamp; `nowMs` is caller-injected —
 * never read from `Date.now()` in here — so a test can pin an exact diff,
 * the same discipline `booking.ts`'s own `nowIso` doc comment requires of
 * every "how long ago" helper in this codebase. Clamped at 0: an event
 * timestamped slightly in the future (clock skew between the DB and the
 * rendering server) reads "now" rather than a nonsensical negative bucket.
 */
export function relativeTime(createdAtIso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(createdAtIso).getTime());
  if (diff < MINUTE_MS) return "now";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h`;
  return `${Math.floor(diff / DAY_MS)}d`;
}
