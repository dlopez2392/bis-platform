// Sibling module to `b/[publicId]/actions.ts` (a `"use server"` file) rather
// than living there itself: Next.js requires every export of a `"use server"`
// module to be an async function, and both `safeZone`/`formatWhen` below are
// synchronous pure helpers. Recorded gotcha — put shared sync helpers in a
// plain sibling module, do NOT scatter per-function directives.

/**
 * Rejects an unusable IANA zone before it can reach `Intl.DateTimeFormat`
 * mid-flight, after a write has already committed. Empty and implausibly
 * long strings (no real zone name approaches 64 chars) are rejected outright
 * without probing; everything else is proven by construction — the same
 * `Intl.DateTimeFormat` construction `formatWhen` itself uses, just run here,
 * before the booking exists, instead of there, after it does.
 */
// Exported for `cancel/[token]/actions.ts` and `cancel/[token]/page.tsx`: the
// cancel flow needs the exact same "validate a booker-supplied zone against
// this row's own account zone" guard this action already proved out, on the
// SAME persisted `booker_timezone` this module wrote at booking time — not a
// second, divergent copy of the `Intl.DateTimeFormat` probe.
export function safeZone(tz: string | undefined, fallback: string): string {
  if (!tz || tz.length > 64) return fallback;
  try {
    // Probe only; the constructor itself is the validation, and its result
    // is discarded on purpose.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

// Exported for the same reason `safeZone` above is: the cancel flow renders
// and mails the identical "when" shape this route already established.
export function formatWhen(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(instant);
}
