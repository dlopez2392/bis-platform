// apps/web/src/lib/work/dismiss-date.ts
//
// "Not now" (Work Queue Task 4) writes a real task due tomorrow at 09:00 in
// the ACCOUNT's own zone (spec §3) — never the server's, never a flat
// +24h. Lives beside `buckets.ts`, not in `tasks/actions.ts`: that file
// carries `"use server"`, where every VALUE export must be an async
// function — a synchronous helper there is a build error vitest cannot see
// (it only surfaces at `pnpm --filter web build`, Task 7's gate).
import { partsInZone, zonedTimeToUtc } from "@/lib/booking/slots";

/**
 * Pure calendar-day-plus-one, done via a UTC noon anchor so month/year
 * rollover is normalized by `Date.UTC` rather than hand-carried — the exact
 * shape of `slots.ts`'s own (unexported) `addCalendarDays`, reimplemented
 * here rather than reached into: this module owns no import into that
 * file's internals, only its two exported, already-reviewed primitives
 * (`partsInZone`, `zonedTimeToUtc`).
 */
function addOneDay(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + 1, 12, 0));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * 09:00 tomorrow, in `zone`, as an ISO instant — or `null` when `zone`
 * cannot be resolved at all. Never substitutes UTC and never throws: a
 * silent UTC fallback is the previous-day defect this milestone already
 * shipped and fixed once (`bucketWork`'s own doc), and `zone` reaches here
 * from the account's free-text timezone column with no validation upstream
 * (create-account-dialog.tsx:80 → actions.ts:13). The caller's job is to
 * treat `null` as "omit the due date", not to guess one.
 *
 * One substitution the paragraph above used to gloss over: an undefined
 * `zone` is not caught by the try/catch below at all.
 * `Intl.DateTimeFormat`'s own `timeZone: undefined` does not throw — it
 * silently resolves the RUNTIME's zone (`partsInZone`'s formatter
 * construction), which is exactly the server-zone substitution this helper
 * exists to refuse. Not reachable today (the `timezone` column is non-null
 * with a default), but the guard below closes it permanently rather than
 * leaving it to a future nullable column or a caller mistake.
 *
 * Deliberately does NOT add 86_400_000 milliseconds — that drifts an hour
 * across a DST boundary (see dismiss-date.test.ts's second case, which is
 * the whole reason this helper exists rather than `now.getTime() + ONE_DAY`
 * inline at the call site). Instead: read today's wall-clock date in `zone`
 * with `partsInZone`, add one calendar day, and convert that wall time back
 * to an instant with `zonedTimeToUtc` — the same two-primitive shape the
 * slot engine itself uses for zone-correct day arithmetic.
 */
export function tomorrowAt9(now: Date, zone: string): string | null {
  if (!zone) return null;
  let today: { y: number; m: number; d: number };
  try {
    today = partsInZone(now, zone);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
  const tomorrow = addOneDay(today.y, today.m, today.d);
  // zonedTimeToUtc returns null only for a wall time that doesn't exist (a
  // DST spring-forward gap) — 09:00 is never inside that gap for any real
  // IANA zone's transition hour, but the null is still handled rather than
  // asserted away, per the same "degrade, don't guess" rule.
  const at9 = zonedTimeToUtc(tomorrow.y, tomorrow.m, tomorrow.d, 9, 0, zone);
  return at9 ? at9.toISOString() : null;
}
