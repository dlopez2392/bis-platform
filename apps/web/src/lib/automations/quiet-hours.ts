import { resolveAccountZone } from "@/lib/booking/followup-timing";

/**
 * Quiet hours, the pure half (spec §2). One window per account, on the
 * ACCOUNT's wall clock, evaluated against an instant the caller supplies —
 * never `Date.now()` — so one tick has one "now" and a test can put the
 * clock anywhere.
 *
 * Two rules and a spelling:
 *   - a window that crosses midnight (the default, 21:00–08:00) is the
 *     normal case: quiet when `t >= start || t < end`;
 *   - a window inside one day (13:00–15:00): quiet when `start <= t < end`;
 *   - `start === end` means disabled, as does `enabled: false`.
 *
 * FAILS CLOSED, and "closed" here means NOT QUIET: an unresolvable zone, an
 * invalid instant or a junk clock string yields `false` from `inQuietWindow`
 * and `null` from `quietWindowEnd`. A reminder that never sends is a
 * no-show; a text at 11 PM is a complaint; a reminder held forever against a
 * misconfigured zone would be the first, silently. The pass logs the zone
 * problem (hold-or-send.ts) so it is visible rather than guessed at.
 *
 * `QuietSettings` is declared here rather than imported from `@bis/db` so
 * this module stays free of the package (imports.test.ts's spirit: a pure
 * module owns no I/O). It is structurally identical to the db's, and
 * hold-or-send.ts hands the db's straight in. The db accessor
 * (`readQuietSettings`) normalises Postgres's `HH:MM:SS` to `HH:MM` before
 * it reaches here; this module never sees seconds.
 */
export type QuietSettings = { enabled: boolean; start: string; end: string };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "21:00" → 1260 (minutes since local midnight); anything else → null. */
export function clockMinutes(hhmm: string): number | null {
  const m = HHMM.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

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
function wallInstant(year: number, month: number, day: number, minutes: number, zone: string): Date {
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

function nextDay(w: Wall): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function evaluateWindow(now: Date, zone: string, s: QuietSettings) {
  if (!s.enabled) return null;
  const start = clockMinutes(s.start);
  const end = clockMinutes(s.end);
  if (start === null || end === null || start === end) return null;
  const resolvedZone = resolveAccountZone(zone);
  if (resolvedZone === null || !Number.isFinite(now.getTime())) return null;
  const wall = wallOf(now, resolvedZone);
  const quiet = start < end ? wall.minutes >= start && wall.minutes < end : wall.minutes >= start || wall.minutes < end;
  return { quiet, end, zone: resolvedZone, wall };
}

export function inQuietWindow(now: Date, zone: string, s: QuietSettings): boolean {
  return evaluateWindow(now, zone, s)?.quiet ?? false;
}

/**
 * The next instant the CURRENT window ends, or null when `now` is not
 * inside one. If the wall clock has not yet reached `end` today (the
 * morning half of a crossing window, or any non-crossing window), that is
 * today's `end`; otherwise tomorrow's. Resolved through the wall-time fixed
 * point, so a 08:00 end is 08:00 on the clock on both sides of a DST change.
 */
export function quietWindowEnd(now: Date, zone: string, s: QuietSettings): Date | null {
  const r = evaluateWindow(now, zone, s);
  if (!r || !r.quiet) return null;
  const day = r.wall.minutes < r.end ? r.wall : nextDay(r.wall);
  return wallInstant(day.year, day.month, day.day, r.end, r.zone);
}

/** "21:00" → "9:00 PM". A string that is not a clock comes back unchanged. */
export function formatClock(hhmm: string): string {
  const minutes = clockMinutes(hhmm);
  if (minutes === null) return hhmm;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)));
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
