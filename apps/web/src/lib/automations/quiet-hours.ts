import { resolveAccountZone } from "@/lib/booking/followup-timing";

/**
 * Wall-clock arithmetic, the pure half of what was the quiet-hours module.
 * The per-account window itself is retired (consent chain spec decision 4):
 * the fixed sending hours are lib/consent/hours.ts, which uses `wallInstant`
 * from here, as does lib/reports/month-window.ts. `formatInstantClock` words
 * a held row's "Held until 8:00 AM".
 */
type Wall = { year: number; month: number; day: number; minutes: number };

/**
 * `hourCycle: "h23"`, never `hour12: false` (midnight renders as "24" in
 * several locales), and "en-US" pinned so no non-Gregorian calendar sneaks
 * in — the same two rules followup-timing.ts's `localParts` states.
 */
function wallOf(instant: Date, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { year: get("year"), month: get("month"), day: get("day"), minutes: get("hour") * 60 + get("minute") };
}

/**
 * A wall reading collapsed to one comparable integer (calendar day, in
 * epoch minutes, plus minutes-of-day). Not a real instant — never fed back
 * through `Date.UTC` as anything but a calculator — only ever compared to
 * another `wallKey` to answer "which of two wall times comes first".
 */
function wallKey(w: { year: number; month: number; day: number; minutes: number }): number {
  return Date.UTC(w.year, w.month - 1, w.day) / 60000 + w.minutes;
}

/**
 * The earliest instant, at minute precision, whose wall reading in `zone` is
 * at or after `requestedKey` (see `wallKey`) — a binary search over a ±3h
 * bracket centred on `near`, the fixed point's own (possibly pre-gap)
 * answer. ±3h comfortably spans the IANA database's largest scheduled gap,
 * and the bracket brackets exactly one discontinuity (the gap `near` sits
 * next to, which is why `wallInstant` called this in the first place), so
 * the wall reading is monotonic across it and the search converges on the
 * gap's end: the first real instant the clock could show `requestedKey` or
 * later.
 */
function firstWallReadingAtOrAfter(requestedKey: number, near: number, zone: string): Date {
  let lo = Math.floor(near / 60000) - 180;
  let hi = Math.floor(near / 60000) + 180;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const key = wallKey(wallOf(new Date(mid * 60000), zone));
    if (key >= requestedKey) hi = mid; else lo = mid + 1;
  }
  return new Date(lo * 60000);
}

/**
 * The UTC instant at which `zone`'s wall clock reads `minutes` past midnight
 * on the given local date — weekly-window.ts's `localMidnightInstant` fixed
 * point, generalised to any minute. Two iterations converge for every real
 * offset THAT WAS ACTUALLY SHOWN; a wall time that does not exist (the
 * spring-forward gap) is a different case, and the naive two-iteration
 * answer for it is not reliably on either side — measured: asking Chicago
 * for the nonexistent 2026-03-08 02:30 converges to 01:30, an HOUR BEFORE
 * the request, not after it; asking Havana for its own nonexistent
 * 2026-03-08 00:00 converges to 23:00 the PREVIOUS day. Both are wrong in
 * the way that matters most for this module: a "window end" computed that
 * way can land in the past relative to `now`.
 *
 * So the converged instant is re-read and checked against what was asked
 * for. A mismatch means the request fell in a gap, and
 * `firstWallReadingAtOrAfter` finds the actual answer: the first instant on
 * or after which the clock could show the requested time — the gap's end,
 * which is the right answer for "the window ends at 02:30" because that
 * moment does not exist and the next one the clock can show is where the
 * window has to end instead.
 */
/**
 * Exported for `lib/reports/month-window.ts` (part-C cleanup item 4):
 * `weekly-window.ts`'s `localMidnightInstant` reconciles HOURS only, so a
 * month boundary lands 30/45 minutes wrong in a minute-offset zone (Asia/
 * Kolkata, Australia/Adelaide, America/St_Johns) and can converge on the
 * wrong side of a spring-forward gap entirely where local midnight itself
 * does not exist. This is the one correct wall-time fixed point in the repo
 * (minute precision, gap-checked) — a month window is a wall-clock boundary
 * exactly like a quiet-hours window's end, so it reuses this rather than
 * duplicating the fix. `weekly-window.ts`'s own callers (the weekly report)
 * are untouched; only the month card moved.
 */
export function wallInstant(year: number, month: number, day: number, minutes: number, zone: string): Date {
  const target = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const seen = wallOf(new Date(ts), zone);
    const seenTs = Date.UTC(seen.year, seen.month - 1, seen.day, Math.floor(seen.minutes / 60), seen.minutes % 60, 0);
    ts += target - seenTs;
  }
  const requestedKey = wallKey({ year, month, day, minutes });
  if (wallKey(wallOf(new Date(ts), zone)) !== requestedKey) {
    return firstWallReadingAtOrAfter(requestedKey, ts, zone);
  }
  return new Date(ts);
}

/**
 * An instant on the account's wall clock: "8:00 AM". Unresolvable zone →
 * UTC, labelled by the caller. Never throws — an invalid instant returns
 * "?", matching `formatClock`'s own never-throws contract.
 */
export function formatInstantClock(instant: Date, zone: string): string {
  if (!Number.isFinite(instant.getTime())) return "?";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: resolveAccountZone(zone) ?? "UTC",
  }).format(instant);
}
