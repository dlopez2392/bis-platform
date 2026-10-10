import { DEMO_OPEN_HOURS } from "./fiction";

/**
 * When each of the demo's calls happened, in the account's LOCAL time.
 *
 * The dashboard's "After-hours captured" tile compares answered calls outside
 * the calendar's opening hours over the last 7 local days with the 7 before
 * (apps/web lib/dashboard/metrics.ts `countAfterHours`, page.tsx's two
 * windows). The seed used to place every call at `now - daysAgo - 8..17
 * hours`, which put each one in or out of hours by chance and left the delta
 * to a coin flip that shifted with the weekday of the capture: the
 * 2026-10-09 capture read "9, 0%" and the 2026-10-10 one "8, ▼ 11%", in red,
 * on the tile the website's second hotspot points at ("After hours, still
 * answered").
 *
 * So the timing is planned, not drawn: each call is put on a named local day
 * and either inside that day's opening hours or outside them, and exactly
 * AFTER_HOURS.current answered calls land outside hours in the recent window
 * against AFTER_HOURS.prior in the one before, whichever weekday the seed
 * runs on. A closed day (Sunday) makes every call on it after-hours whatever
 * time it is placed at, so those are counted first and the rest of the
 * target is met from open days.
 *
 * Portraying the business as steady and growing is a choice about a
 * fictional company (seed.ts says the same of the call volume); the numbers
 * the dashboard then shows are still computed honestly from these rows.
 */

/** Calls per local day, most recent day first: `[k, count]`, where `k` days
 *  before the seed's local date. Today (k=0) has none: the seed runs at 5 AM,
 *  and a 2 AM call on a marketing screenshot reads as a bug. 4+4+3·4 = 20 in
 *  the dashboard's current window (k=0..6), 2·7 = 14 in the prior (k=7..13). */
const PER_DAY: readonly (readonly [number, number])[] = [
  [1, 4], [2, 4], [3, 3], [4, 3], [5, 3], [6, 3],
  [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2],
];
export const DEMO_CALL_COUNT = PER_DAY.reduce((n, [, c]) => n + c, 0);

/** Answered calls outside opening hours, per window. Current above prior, by
 *  a margin a tile reads as steady growth (▲ 40%), not as a stunt. */
export const AFTER_HOURS = { current: 7, prior: 5 } as const;

/** Outcomes the dashboard does not count as answered. */
const UNANSWERED = new Set(["spam", "abandoned"]);

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function zoneParts(ms: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mi: get("minute"), ss: get("second") };
}

/** The instant a local wall-clock time names in `timezone`. Two passes, so a
 *  time on a DST-change day resolves against that day's own offset. */
function localToUtc(y: number, m: number, d: number, minutes: number, timezone: string): number {
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = wall;
  for (let pass = 0; pass < 2; pass++) {
    const p = zoneParts(guess, timezone);
    const asWall = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.ss);
    guess += wall - asWall;
  }
  return guess;
}

function minutesOf(hhmm: string): number {
  const [h, mi] = hhmm.split(":").map(Number);
  return h! * 60 + mi!;
}

export interface PlannedCall {
  /** Epoch ms. */
  startedAt: number;
  /** True when the call falls outside that local day's opening hours. */
  afterHours: boolean;
}

/**
 * `outcomes[i]` is call i's outcome, most recent call first (seed.ts's order,
 * `DEMO_TRANSCRIPTS[i % 8]`). Returns one planned call per entry.
 *
 * `pinAfterHours` names calls that must land outside hours, counted toward
 * their window's target like any other. seed.ts pins the most recent booked
 * Spanish call, the one the website's call-detail screenshot shows: an
 * evening booking in Spanish is the product's whole argument in one row.
 */
export function planDemoCalls(
  now: number, timezone: string, outcomes: readonly string[], pinAfterHours: readonly number[] = [],
): PlannedCall[] {
  if (outcomes.length !== DEMO_CALL_COUNT) {
    throw new Error(`planDemoCalls: expected ${DEMO_CALL_COUNT} outcomes, got ${outcomes.length}`);
  }
  const today = zoneParts(now, timezone);

  type Slot = { i: number; k: number; window: "current" | "prior"; open: [number, number] | null; answered: boolean };
  const slots: Slot[] = [];
  let i = 0;
  for (const [k, count] of PER_DAY) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d - k));
    const hours = DEMO_OPEN_HOURS[WEEKDAY_KEYS[date.getUTCDay()]!]?.[0];
    for (let n = 0; n < count; n++, i++) {
      slots.push({
        i, k, window: k <= 6 ? "current" : "prior",
        open: hours ? [minutesOf(hours[0]), minutesOf(hours[1])] : null,
        answered: !UNANSWERED.has(outcomes[i]!),
      });
    }
  }

  // Which answered calls go outside hours: every answered call on a closed
  // day (no choice there), then open-day answered calls spread evenly across
  // the window until its target is met. Unanswered calls are never chosen;
  // they do not count, and spam that rings at 2 AM is not the story.
  const afterHours = new Set<number>();
  for (const window of ["current", "prior"] as const) {
    const answered = slots.filter((s) => s.window === window && s.answered);
    const pinned = (s: Slot) => !s.open || pinAfterHours.includes(s.i);
    for (const s of answered) if (pinned(s)) afterHours.add(s.i);
    const forced = answered.filter(pinned).length;
    const candidates = answered.filter((s) => !pinned(s));
    const need = Math.min(candidates.length, Math.max(0, AFTER_HOURS[window] - forced));
    for (let n = 0; n < need; n++) {
      afterHours.add(candidates[Math.floor((n * candidates.length) / need)]!.i);
    }
  }

  // Inside hours: spread across the opening window, clear of its edges.
  // Outside: the evening after closing, or on a closed day across its daytime
  // (still after-hours by definition). The call log sorts by start time, so
  // nothing depends on index order within a day.
  return slots.map((s) => {
    const sameDay = slots.filter((x) => x.k === s.k);
    const rank = sameDay.indexOf(s); // 0 = latest that day
    const share = (sameDay.length - rank) / (sameDay.length + 1);
    let minutes: number;
    if (!s.open) {
      minutes = 10 * 60 + Math.round(share * 7 * 60);            // 10:00–17:00
    } else if (afterHours.has(s.i)) {
      const from = Math.max(s.open[1] + 60, 18 * 60);            // an hour past close, not before 6 PM
      minutes = from + Math.round(share * 150);                  // within the next 2½ hours
    } else {
      const span = s.open[1] - s.open[0] - 60;
      minutes = s.open[0] + 30 + Math.round(share * span);       // 30 min clear of each edge
    }
    // A minute offset per call, so no two calls share a clock time.
    minutes += (s.i * 7) % 11;
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d - s.k));
    return {
      startedAt: localToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), minutes, timezone),
      afterHours: afterHours.has(s.i) || !s.open,
    };
  });
}
