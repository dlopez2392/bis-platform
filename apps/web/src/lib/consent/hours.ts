import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { wallInstant } from "@/lib/automations/quiet-hours";

/**
 * The FIXED sending hours (consent chain spec decision 4, choices 18 and 31).
 * They cannot be switched off, and nothing reads the old per-account quiet
 * hours any more (`automation_settings.quiet_*`, source scan 5).
 *
 *   automated  08:00–21:00 every day, in the recipient's zone: every
 *              automated text, and every automated email (choice 31);
 *   marketing  09:00–21:00 Monday to Saturday, 12:00–21:00 on Sunday: the
 *              Texas solicitation hours (Tex. Bus. & Com. Code §301.051, an
 *              ASSUMPTION that they reach texts, for counsel);
 *   any        no window: staff-typed replies, operator alerts and codes.
 *
 * The start is inside the window and the end is outside it: 20:59 sends,
 * 21:00 waits for tomorrow's opening.
 *
 * The RECIPIENT's zone is the contact's when one is known, otherwise the
 * account's (spec §4.1 item 2). BIS stores no contact zone yet, so callers
 * pass the account's. A zone Intl cannot resolve falls back to
 * America/Chicago (0001's default for `accounts.timezone`), never to "no
 * window": the old quiet-hours module failed OPEN on a junk zone, which a
 * fixed legal window cannot.
 */
export type HoursRule = "automated" | "marketing" | "any";

export const FALLBACK_ZONE = "America/Chicago";

const CLOSE = 21 * 60;

function openingMinute(rule: Exclude<HoursRule, "any">, weekday: number): number {
  if (rule === "automated") return 8 * 60;
  return weekday === 0 ? 12 * 60 : 9 * 60;
}

type Wall = { year: number; month: number; day: number; weekday: number; minutes: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** `hourCycle: "h23"` and "en-US", for the reasons quiet-hours.ts's `wallOf` gives. */
function wallOf(instant: Date, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    weekday: WEEKDAYS[get("weekday")] ?? NaN,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function nextCalendarDay(w: Wall): { year: number; month: number; day: number; weekday: number } {
  const t = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), weekday: t.getUTCDay() };
}

/** The zone a window is read in: the recipient's, or the fallback. */
export function hoursZone(zone: string | null | undefined): string {
  return resolveAccountZone(zone) ?? FALLBACK_ZONE;
}

/**
 * Null when a send under `rule` may go at `now` in `zone`; otherwise the
 * next instant the window opens. Throws only on an invalid `now` (a caller
 * bug, never data).
 */
export function nextOpening(rule: HoursRule, now: Date, zone: string | null | undefined): Date | null {
  if (rule === "any") return null;
  if (!Number.isFinite(now.getTime())) throw new Error("nextOpening: invalid instant");
  const z = hoursZone(zone);
  const wall = wallOf(now, z);
  const open = openingMinute(rule, wall.weekday);
  if (wall.minutes >= open && wall.minutes < CLOSE) return null;
  if (wall.minutes < open) return wallInstant(wall.year, wall.month, wall.day, open, z);
  const next = nextCalendarDay(wall);
  return wallInstant(next.year, next.month, next.day, openingMinute(rule, next.weekday), z);
}

/**
 * Choice 21: a send whose purpose has passed before its window opens is not
 * sent at all. `deadline` at or before the opening → true. A send inside
 * its window, or with no deadline, never expires here.
 */
export function expiresBeforeOpening(opening: Date | null, deadline: Date | null | undefined): boolean {
  if (opening === null || !deadline) return false;
  return deadline.getTime() <= opening.getTime();
}
