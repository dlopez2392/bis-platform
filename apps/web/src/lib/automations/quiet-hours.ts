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
 * hold-or-send.ts hands the db's straight in.
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
 * The UTC instant at which `zone`'s wall clock reads `minutes` past midnight
 * on the given local date — weekly-window.ts's `localMidnightInstant` fixed
 * point, generalised to any minute. Two iterations converge for every real
 * offset; a wall time that does not exist (the spring-forward gap) resolves
 * to the instant after the gap, which is the right answer for "the window
 * ends at 08:00" because 08:00 always exists.
 */
function wallInstant(year: number, month: number, day: number, minutes: number, zone: string): Date {
  const target = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const seen = wallOf(new Date(ts), zone);
    const seenTs = Date.UTC(seen.year, seen.month - 1, seen.day, Math.floor(seen.minutes / 60), seen.minutes % 60, 0);
    ts += target - seenTs;
  }
  return new Date(ts);
}

function nextDay(w: Wall): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function resolve(now: Date, zone: string, s: QuietSettings) {
  if (!s.enabled) return null;
  const start = clockMinutes(s.start);
  const end = clockMinutes(s.end);
  if (start === null || end === null || start === end) return null;
  const resolved = resolveAccountZone(zone);
  if (resolved === null || !Number.isFinite(now.getTime())) return null;
  const wall = wallOf(now, resolved);
  const quiet = start < end ? wall.minutes >= start && wall.minutes < end : wall.minutes >= start || wall.minutes < end;
  return { quiet, end, resolved, wall };
}

export function inQuietWindow(now: Date, zone: string, s: QuietSettings): boolean {
  return resolve(now, zone, s)?.quiet ?? false;
}

/**
 * The next instant the CURRENT window ends, or null when `now` is not
 * inside one. If the wall clock has not yet reached `end` today (the
 * morning half of a crossing window, or any non-crossing window), that is
 * today's `end`; otherwise tomorrow's. Resolved through the wall-time fixed
 * point, so a 08:00 end is 08:00 on the clock on both sides of a DST change.
 */
export function quietWindowEnd(now: Date, zone: string, s: QuietSettings): Date | null {
  const r = resolve(now, zone, s);
  if (!r || !r.quiet) return null;
  const day = r.wall.minutes < r.end ? r.wall : nextDay(r.wall);
  return wallInstant(day.year, day.month, day.day, r.end, r.resolved);
}

/** "21:00" → "9:00 PM". A string that is not a clock comes back unchanged. */
export function formatClock(hhmm: string): string {
  const minutes = clockMinutes(hhmm);
  if (minutes === null) return hhmm;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)));
}

/** An instant on the account's wall clock: "8:00 AM". Unresolvable zone → UTC, labelled by the caller. */
export function formatInstantClock(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: resolveAccountZone(zone) ?? "UTC",
  }).format(instant);
}
