import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
  REVIEW_REQUEST_MAX_AGE_MS, NO_SHOW_NUDGE_MAX_AGE_MS, REFERRAL_ASK_MAX_AGE_MS,
  SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
  APPOINTMENT_CONFIRM_WINDOW_START_MS, APPOINTMENT_CONFIRM_WINDOW_END_MS,
  APPOINTMENT_CONFIRM_MIN_LEAD_MS,
  LATE_REMINDER_WINDOW_START_MS, LATE_REMINDER_WINDOW_END_MS, LATE_REMINDER_MIN_AGE_MS, isLateBooking,
} from "@bis/db";
import { FOLLOWUP_MAX_AGE_MS } from "@/lib/booking/followup-timing";
import { ABANDONED_UPLOAD_MS, SIGNED_UPLOAD_URL_MS } from "./passes/documents-sweep";
import { reminderDeadline } from "@/lib/booking/reminder-timing";
import { nextOpening, expiresBeforeOpening } from "@/lib/consent/hours";
import {
  SMS_RETRY_COOLDOWN_MS, USAGE_REPORT_BUDGET_MS, WEEKLY_REPORT_BUDGET_MS,
  WEEKLY_REPORT_MAX_RECIPIENTS, WEEKLY_REPORT_ACCOUNT_MARGIN_MS, WEEKLY_REPORT_ACCOUNT_END_MS, REPORT_EMAIL_WORST_CASE_MS,
} from "./caps";
import { TICK_NOW_MAX_AGE_MS } from "./pass-route";
import { RELEASE_BUDGET_MS } from "./passes/release-held";
import { DOCUMENT_SCAN_BUDGET_MS } from "./passes/documents-scan";
import { EXPIRY_BUDGET_MS } from "./passes/documents-expiry";
import { CANCEL_NOTICE_BUDGET_MS } from "./passes/cancel-notices";
import {
  PLAN, longestPathS, PASS_ROUTE_MAX_S, JOBS_DRAIN_MAX_S, JOBS_DRAIN_KEY, DISPATCHER_MAX_S,
  DISPATCH_SLACK_S, LEGACY_TICK_CEILING_S,
} from "./fanout";
import { RATE_LIMIT_MAX_WAIT_MS, SEND_TIMEOUT_MS } from "@/lib/http/retry-after";

/**
 * The three-way coupling (schedule ↔ reminder window ↔ follow-up window) was
 * enforced by comments only, and the ledger carried that as an open concern
 * since the Pro cadence change. This is the enforcement. The schedule is
 * READ from vercel.json rather than restated here — restating it would just
 * be a fourth copy.
 */
const MINUTE = 60 * 1000;
const vercel = JSON.parse(
  readFileSync(new URL("../../../vercel.json", import.meta.url), "utf-8"),
) as { crons: { path: string; schedule: string }[] };
const routeSource = readFileSync(
  new URL("../../app/api/cron/reminders/route.ts", import.meta.url), "utf-8",
);
const passRouteSource = readFileSync(
  new URL("../../app/api/cron/pass/[key]/route.ts", import.meta.url), "utf-8",
);
/** A route's LIVE `maxDuration`, anchored to a whole line so a commented-out export cannot match. NaN when absent. */
function declaredMaxDuration(source: string): number {
  const m = /^export const maxDuration = (\d+);$/m.exec(source);
  return m ? Number(m[1]) : Number.NaN;
}

function tickIntervalMs(schedule: string): number {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(schedule);
  if (!m) throw new Error(`schedule is not of the form "*/N * * * *": ${schedule}`);
  return Number(m[1]) * MINUTE;
}

describe("the cron schedule and the query windows are coupled — enforced, not described", () => {
  const entry = vercel.crons.find((c) => c.path === "/api/cron/reminders");

  it("vercel.json has the reminders tick and the morning demo rebuild, and nothing else", () => {
    // The second entry (2026-10-20) only dispatches the demo's rebuild
    // workflow (app/api/cron/demo-refresh); it runs no automation pass.
    expect(vercel.crons.map((c) => c.path).sort()).toEqual(["/api/cron/demo-refresh", "/api/cron/reminders"]);
    expect(entry).toBeDefined();
    expect(vercel.crons.find((c) => c.path === "/api/cron/demo-refresh")!.schedule).toBe("17 10 * * *");
  });

  it("the reminder window is wider than one tick, so no booking can fall between two ticks", () => {
    const tick = tickIntervalMs(entry!.schedule);
    expect(tick).toBe(15 * MINUTE);
    expect(REMINDER_WINDOW_END_MS - REMINDER_WINDOW_START_MS).toBeGreaterThan(tick);
  });

  it("the follow-up query window equals the web-side staleness cap", () => {
    expect(FOLLOWUP_QUERY_WINDOW_MS).toBe(FOLLOWUP_MAX_AGE_MS);
  });

  it("the review-request cap is the follow-up cap plus one local day", () => {
    expect(REVIEW_REQUEST_MAX_AGE_MS).toBe(FOLLOWUP_MAX_AGE_MS + 24 * 60 * MINUTE);
  });

  it("the referral ask is the review request's cap plus one local day — one rung further down the ladder", () => {
    // THE LITERALS FIRST. The ladder's whole span, stated once: follow-up 37h,
    // review 61h, referral 85h. Mutation: change any one constant → this reds.
    expect([FOLLOWUP_MAX_AGE_MS, REVIEW_REQUEST_MAX_AGE_MS, REFERRAL_ASK_MAX_AGE_MS])
      .toEqual([37 * 60 * MINUTE, 61 * 60 * MINUTE, 85 * 60 * MINUTE]);
    // The derivation second, and only as a STATEMENT of the relationship: on
    // its own it mirrors `REFERRAL_ASK_MAX_AGE_MS`'s own definition and reds
    // for nothing but a sign flip.
    expect(REFERRAL_ASK_MAX_AGE_MS).toBe(REVIEW_REQUEST_MAX_AGE_MS + 24 * 60 * MINUTE);
  });

  it("the SMS reminder window is wider than one tick, and fires about two hours ahead", () => {
    // Mutation: change either constant alone.
    const tick = tickIntervalMs(entry!.schedule);
    expect(SMS_REMINDER_WINDOW_END_MS - SMS_REMINDER_WINDOW_START_MS).toBeGreaterThan(tick);
    expect(SMS_REMINDER_WINDOW_END_MS).toBe(135 * MINUTE);
    expect(SMS_REMINDER_WINDOW_START_MS).toBe(90 * MINUTE);
  });

  it("the appointment-confirm window is wider than one tick, and asks two days out", () => {
    const tick = tickIntervalMs(entry!.schedule);
    expect(APPOINTMENT_CONFIRM_WINDOW_END_MS - APPOINTMENT_CONFIRM_WINDOW_START_MS).toBeGreaterThan(tick);
    expect(APPOINTMENT_CONFIRM_WINDOW_START_MS).toBe(47 * 60 * MINUTE);
    expect(APPOINTMENT_CONFIRM_WINDOW_END_MS).toBe(48 * 60 * MINUTE + 15 * MINUTE);
    // Mutation: move the window start to 46h without touching vercel.json → red.
  });

  it("the confirmation ask stops at the instant the email reminder becomes eligible", () => {
    // ONE TEXT AND ONE EMAIL in the same quarter hour — "can you confirm?" and
    // "here's your reminder" — is the collision this bound exists to prevent.
    // NOT two texts: the SMS reminder's window is 90–135 minutes and can never
    // meet a lead measured in days.
    //
    // `>= REMINDER_WINDOW_END_MS`, never `>= REMINDER_WINDOW_START_MS`. The
    // email reminder's due window is [now+23h, now+24h15m] and a booking first
    // MATCHES it when its lead is 24h15m — the window's CLOSE is where the
    // reminder OPENS. Comparing against the START would have passed with a
    // flat 24h lead and left a fifteen-minute band where both are due; that is
    // the bug this case was rewritten to catch.
    expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBe(24 * 60 * MINUTE + 15 * MINUTE);
    expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBeGreaterThanOrEqual(REMINDER_WINDOW_END_MS);
  });

  it("D-029: the late email reminder is wider than one tick, fires 3h-4h15m ahead, and never shares a tick with the day-before window", () => {
    // Mutation: change any one constant alone → red.
    const tick = tickIntervalMs(entry!.schedule);
    expect(LATE_REMINDER_WINDOW_END_MS - LATE_REMINDER_WINDOW_START_MS).toBeGreaterThan(tick);
    expect([LATE_REMINDER_WINDOW_START_MS, LATE_REMINDER_WINDOW_END_MS, LATE_REMINDER_MIN_AGE_MS])
      .toEqual([180 * MINUTE, 255 * MINUTE, 60 * MINUTE]);
    // Disjoint from the day-before window on starts_at: one tick cannot list
    // a booking under both, which is half of "cannot double-send" (the other
    // half is reminder_sent_at, pinned in packages/db's booking.test.ts).
    expect(LATE_REMINDER_WINDOW_END_MS).toBeLessThan(REMINDER_WINDOW_START_MS);
  });

  /**
   * D-029 review. Comparing the windows' constants proved nothing about the
   * night: OUTSIDE the sending hours (08:00-21:00) both the late email and
   * the text reminder are HELD, and both are released at 08:00. This replays
   * the cron, tick by tick, for every appointment in a day (every quarter
   * hour) and every booking time from 24h15m to 3h ahead (every 5 minutes),
   * through the REAL `nextOpening` / `expiresBeforeOpening` and the REAL
   * deadlines the two passes give holdOrSend (`reminderDeadline` for the
   * email, the start for the text). At each due tick: inside the hours it
   * sends; outside, it is dropped if its deadline is at or before the
   * opening (choice 21, and it is listed again next tick), else held and
   * released at the opening.
   *
   * Pinned: (1) the email and the text never land in the same quarter hour;
   * (2) no email goes at or after the start; (3) the price, exactly as the
   * comment on LATE_REMINDER_WINDOW_START_MS states it — an appointment that
   * loses its late email is one at or before 10:15.
   * Mutation: give the late email the start as its deadline → the 09:00
   * appointment's email and text both land at 08:00 → FAILS.
   */
  it("D-029 review: held overnight and released at 08:00, the late email and the text reminder never land together", () => {
    const tick = tickIntervalMs(entry!.schedule);
    const zone = "America/Chicago";
    const dayStart = Date.parse("2027-04-06T05:00:00Z"); // 00:00 CDT, no DST edge that day
    type Landing = number | "never";
    // The real function, memoised per tick: every case shares the same ~200 ticks.
    const openings = new Map<number, Date | null>();
    const openingAt = (t: number) => {
      if (!openings.has(t)) openings.set(t, nextOpening("automated", new Date(t), zone));
      return openings.get(t)!;
    };
    const land = (dueAt: (t: number) => boolean, deadline: Date, from: number, until: number): Landing => {
      for (let t = Math.ceil(from / tick) * tick; t < until; t += tick) {
        if (!dueAt(t)) continue;
        const opening = openingAt(t);
        if (!opening) return t;
        if (expiresBeforeOpening(opening, deadline)) continue; // skipped; listed again next tick
        return opening.getTime();                               // held; released at the opening
      }
      return "never";
    };
    let collisions = 0;
    let emailAfterStart = 0;
    const droppedStarts = new Set<number>();
    for (let s = dayStart; s < dayStart + 24 * 60 * MINUTE; s += 15 * MINUTE) {
      const startsAt = new Date(s).toISOString();
      for (let lead = 3 * 60; lead <= 24 * 60 + 15; lead += 5) {
        const b = s - lead * MINUTE;
        const createdAt = new Date(b).toISOString();
        if (!isLateBooking(createdAt, startsAt)) continue;
        const email = land(
          (t) => s >= t + LATE_REMINDER_WINDOW_START_MS && s <= t + LATE_REMINDER_WINDOW_END_MS
            && b <= t - LATE_REMINDER_MIN_AGE_MS,
          reminderDeadline({ startsAt, late: true }, { textCovers: true }), Math.max(b, s - LATE_REMINDER_WINDOW_END_MS), s);
        const text = land(
          (t) => s >= t + SMS_REMINDER_WINDOW_START_MS && s <= t + SMS_REMINDER_WINDOW_END_MS,
          new Date(s), Math.max(b, s - SMS_REMINDER_WINDOW_END_MS), s);
        if (typeof email === "number" && email >= s) emailAfterStart++;
        if (typeof email === "number" && typeof text === "number" && Math.abs(email - text) < tick) collisions++;
        // An email the window reached but the deadline dropped at every due tick.
        const windowReached = lead * MINUTE >= LATE_REMINDER_WINDOW_START_MS + LATE_REMINDER_MIN_AGE_MS;
        if (email === "never" && windowReached) droppedStarts.add(s);
      }
    }
    expect(collisions).toBe(0);
    expect(emailAfterStart).toBe(0);
    const latestDropped = Math.max(...droppedStarts);
    expect((latestDropped - dayStart) / MINUTE).toBe(10 * 60 + 15); // the latest that loses it: 10:15 exactly
    expect(droppedStarts.size).toBeGreaterThan(0); // the price is real, and the sweep sees it
  });

  /**
   * S-09 PR 2 (C16, Q3): with texting OFF, every late-booked appointment that starts after 08:45 gets its
   * email at or after 08:00 and at least 45 minutes ahead; none at or before 08:45 gets one. The same
   * replay as the D-029 case above, run on four days: an ordinary Chicago day, Chicago's spring-forward
   * day (23 hours; 08:00 CDT is 13:00Z) and fall-back day (25 hours; 08:00 CST is 14:00Z), and UTC+14
   * (Kiritimati), whose local day starts at 10:00Z the day BEFORE. Times of day are read on the ZONE's
   * wall clock, never as elapsed minutes from midnight, which drift by an hour on both DST days.
   * Mutation: MORNING_OF_MIN_NOTICE_MS = 60 minutes -> the 09:00 appointment gets none -> FAILS.
   * Mutation: reminderDeadline ignores textCovers (start - 2h15m always) -> every start before 10:30 loses
   * it -> FAILS.
   */
  it.each([
    ["America/Chicago, an ordinary day", "America/Chicago", "2027-04-06T05:00:00Z", "2027-04-07T05:00:00Z"],
    ["America/Chicago, spring forward", "America/Chicago", "2027-03-14T06:00:00Z", "2027-03-15T05:00:00Z"],
    ["America/Chicago, fall back", "America/Chicago", "2026-11-01T05:00:00Z", "2026-11-02T06:00:00Z"],
    ["Pacific/Kiritimati (UTC+14)", "Pacific/Kiritimati", "2027-04-05T10:00:00Z", "2027-04-06T10:00:00Z"],
  ])("S-09: with no text reminder, a late-booked appointment after 08:45 is emailed at 08:00, at least 45 minutes ahead (%s)", (_label, zone, dayStartIso, dayEndIso) => {
    const tick = tickIntervalMs(entry!.schedule);
    const dayStart = Date.parse(dayStartIso);
    const dayEnd = Date.parse(dayEndIso);
    type Landing = number | "never";
    const wall = Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const wallMinutes = (t: number) => {
      const parts = wall.formatToParts(new Date(t));
      return Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
    };
    // The bounds are local midnights: a wrong one would make this sweep a different day.
    expect([wallMinutes(dayStart), wallMinutes(dayEnd)]).toEqual([0, 0]);
    const openings = new Map<number, Date | null>();
    const openingAt = (t: number) => {
      if (!openings.has(t)) openings.set(t, nextOpening("automated", new Date(t), zone));
      return openings.get(t)!;
    };
    const land = (dueAt: (t: number) => boolean, deadline: Date, from: number, until: number): Landing => {
      for (let t = Math.ceil(from / tick) * tick; t < until; t += tick) {
        if (!dueAt(t)) continue;
        const opening = openingAt(t);
        if (!opening) return t;
        if (expiresBeforeOpening(opening, deadline)) continue;
        return opening.getTime();
      }
      return "never";
    };
    let earlyEmailed = 0;
    let checked = 0;
    const keptStarts = new Set<number>();
    const eveningBefore0900: number[] = [];
    for (let s = dayStart; s < dayEnd; s += 15 * MINUTE) {
      const startsAt = new Date(s).toISOString();
      const startWall = wallMinutes(s);
      for (let lead = 3 * 60; lead <= 24 * 60 + 15; lead += 5) {
        const b = s - lead * MINUTE;
        if (!isLateBooking(new Date(b).toISOString(), startsAt)) continue;
        const email = land(
          (t) => s >= t + LATE_REMINDER_WINDOW_START_MS && s <= t + LATE_REMINDER_WINDOW_END_MS && b <= t - LATE_REMINDER_MIN_AGE_MS,
          reminderDeadline({ startsAt, late: true }, { textCovers: false }), Math.max(b, s - LATE_REMINDER_WINDOW_END_MS), s);
        const windowReached = lead * MINUTE >= LATE_REMINDER_WINDOW_START_MS + LATE_REMINDER_MIN_AGE_MS;
        if (!windowReached) continue;
        checked++;
        if (typeof email === "number") {
          expect(s - email, `start ${startWall}`).toBeGreaterThanOrEqual(45 * MINUTE);
          expect(wallMinutes(email), `start ${startWall}: inside the sending hours`).toBeGreaterThanOrEqual(8 * 60);
          expect(wallMinutes(email), `start ${startWall}: inside the sending hours`).toBeLessThan(21 * 60);
          // Released at the morning opening for an appointment at or before 08:45: what Q3 rules out. (An
          // appointment just after midnight is emailed the evening before, inside the hours, 3h+ ahead: kept.)
          if (startWall <= 8 * 60 + 45 && wallMinutes(email) === 8 * 60) earlyEmailed++;
          keptStarts.add(startWall);
          // Booked the evening before (19:00 or earlier the day before): held overnight, released at 08:00 sharp.
          if (startWall === 9 * 60 && lead >= 14 * 60) eveningBefore0900.push(wallMinutes(email));
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(earlyEmailed).toBe(0);                                   // 07:30, 08:30, 08:45: the confirmation only
    for (const m of [7 * 60 + 30, 8 * 60 + 30, 8 * 60 + 45]) expect(keptStarts.has(m), `${m}`).toBe(false);
    for (const m of [9 * 60, 9 * 60 + 30, 10 * 60, 10 * 60 + 15]) expect(keptStarts.has(m), `${m}`).toBe(true);
    expect(eveningBefore0900.length).toBeGreaterThan(0);
    expect(new Set(eveningBefore0900)).toEqual(new Set([8 * 60]));
  });

  it("an upload is called abandoned only after its signed URL has expired and one more tick has passed, so the sweep never deletes a reservation a browser can still fill (mutation: ABANDONED_UPLOAD_MS = 1 h -> FAILS)", () => {
    const tick = tickIntervalMs(entry!.schedule);
    // A MIRROR of storage-js's own constant (createSignedUploadUrl: "valid for 2 hours", dist/index.mjs:792-793),
    // stated so a reader sees the number; the >= below is the guard.
    expect(SIGNED_UPLOAD_URL_MS).toBe(2 * 60 * MINUTE);
    expect(ABANDONED_UPLOAD_MS).toBeGreaterThanOrEqual(SIGNED_UPLOAD_URL_MS + tick);
  });

  it("the no-show nudge cap is the follow-up cap: same derivation, nothing to defer to", () => {
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(FOLLOWUP_MAX_AGE_MS);
  });

  it("the SMS cooldown allows at most three attempts across the review request's window", () => {
    expect(Math.ceil(REVIEW_REQUEST_MAX_AGE_MS / SMS_RETRY_COOLDOWN_MS)).toBe(3);
  });

  it("the text reminder, which has NO cooldown, is bounded by its window to three attempts per booking", () => {
    // danlo, 2026-09-07: a failed text reminder retries next tick. The bound
    // is the window divided by the tick, not a hold — so a wider window or a
    // faster cadence would silently raise it. Mutation: change either.
    // The due query is closed at both ends (gte/lte in listDueSmsReminders),
    // so a tick landing on the bound to the second would see a fourth grid
    // point; the cron's own jitter (observed ticks fire around :24s) makes
    // three the count every real run sees.
    const tick = tickIntervalMs(entry!.schedule);
    expect((SMS_REMINDER_WINDOW_END_MS - SMS_REMINDER_WINDOW_START_MS) / tick).toBe(3);
  });

  it("the in-process tick's ceiling is at least double the release pass's own wall-clock budget — the budget bounds the release pass, and the rest of the tick belongs to the passes after it (mutation: set LEGACY_TICK_CEILING_S to 61 → FAILS)", () => {
    // F-196: retargeted from the route's own `maxDuration` to
    // LEGACY_TICK_CEILING_S. The route now declares the dispatcher's 800 s
    // (pinned live, anchored, in the fan-out describe below); the in-process
    // tick (CRON_FANOUT off) keeps its 300 s budget as a constant, so this
    // coupling still binds the passes the way it did before fan-out.
    // At LEAST double: 61s (one second of headroom) would still pass a
    // ">" check but leaves nothing for the passes that run after the release
    // pass in the same tick. No count in the prose: `PASSES` grows by a line
    // per recipe, and a number written down here rots silently.
    expect(LEGACY_TICK_CEILING_S).toBeGreaterThanOrEqual((RELEASE_BUDGET_MS / 1000) * 2);
  });

  /**
   * Review M2: the test above checks ONE budgeted pass against the tick's
   * ceiling (the route's `maxDuration` until F-196, LEGACY_TICK_CEILING_S
   * since). FIVE passes carry a wall-clock budget today —
   * release-held (RELEASE_BUDGET_MS), the usage report
   * (USAGE_REPORT_BUDGET_MS), since D-067, the weekly client report
   * (WEEKLY_REPORT_BUDGET_MS), since S-07 2a, the document scan pass
   * (DOCUMENT_SCAN_BUDGET_MS), and, since S-07 3a, the documents expiry
   * pass (EXPIRY_BUDGET_MS) — and nothing coupled their SUM to the
   * ceiling: five budgets could be raised independently, each passing
   * its own neighbour's check, until together they left the other
   * registered passes no room at all inside one tick. `MIN_HEADROOM_MS`
   * was one more 60 s budget's worth — the smallest margin that still
   * reads as "room for the rest", not a number tuned to pass today's
   * five. Since the F-048 follow-up it is 50 s: a sixth budget (the
   * cancel-notice sweep, 10 s) moved one of "the rest" into the sum, so the
   * same room is now partly a bound that pass enforces on itself. Mutation: raise any one budget past the point this leaves
   * zero headroom → FAILS; comment out LEGACY_TICK_CEILING_S or any budget
   * export → FAILS (the `Number(...)` on `undefined` is `NaN`, and `NaN`
   * fails every comparison).
   */
  it("the six wall-clock budgets, summed, still leave headroom for the unbudgeted passes inside the in-process tick's ceiling", () => {
    // Since S-07 2a, the document scan pass (DOCUMENT_SCAN_BUDGET_MS, 45 s)
    // joined the other three; since S-07 3a, the documents expiry pass
    // (EXPIRY_BUDGET_MS, 15 s) is the fifth: 60 + 60 + 60 + 45 + 15 = 240 s,
    // plus the 60 s headroom = 300 = the in-process ceiling, exactly.
    // F-048 follow-up: the cancel-notice sweep (CANCEL_NOTICE_BUDGET_MS, 10 s)
    // is the sixth. It was one of the UNBUDGETED passes the 60 s headroom was
    // there for; with its own budget it is counted in the sum instead, so the
    // headroom left for the passes that still have none is 50 s:
    // 240 + 10 + 50 = 300 = the in-process ceiling, exactly. The real room for
    // unbudgeted work is unchanged; part of it is now a stated, enforced bound.
    // The next budget added must come out of a neighbour or raise LEGACY_TICK_CEILING_S.
    // F-196: retargeted to LEGACY_TICK_CEILING_S, the in-process tick's
    // budget (the route itself now declares the dispatcher's 800 s).
    const MIN_HEADROOM_MS = 50_000;
    const sumBudgetsMs = RELEASE_BUDGET_MS + USAGE_REPORT_BUDGET_MS + WEEKLY_REPORT_BUDGET_MS + DOCUMENT_SCAN_BUDGET_MS + EXPIRY_BUDGET_MS
      + CANCEL_NOTICE_BUDGET_MS;
    expect(LEGACY_TICK_CEILING_S * 1000).toBeGreaterThanOrEqual(sumBudgetsMs + MIN_HEADROOM_MS);
  });
});

/**
 * F-196: with `CRON_FANOUT=1` every pass runs in its own function (the pass
 * route, 90 s) and the cron route becomes a dispatcher that awaits the plan
 * (800 s). The couplings, each read from the literal Vercel will honour:
 *  1. every budgeted pass fits its own function, with 30 s for the work
 *     around its budget;
 *  2. every node's ceiling IS its route's ceiling;
 *  3. the plan's longest chain of ceilings, plus slack, fits the dispatcher;
 *  4. the dispatcher ends before the next tick starts (no two dispatchers
 *     overlap);
 *  5. the row in flight past a budget ends inside the pass route: a pass
 *     checks its budget BEFORE a row, so one send can run past it, and one
 *     send is at most attempt + rate-limit wait + attempt (Task 4).
 */
describe("fan-out: each pass in its own function, the plan inside the dispatcher's ceiling", () => {
  const BUDGETS_MS = {
    RELEASE_BUDGET_MS, USAGE_REPORT_BUDGET_MS, WEEKLY_REPORT_BUDGET_MS,
    DOCUMENT_SCAN_BUDGET_MS, EXPIRY_BUDGET_MS, CANCEL_NOTICE_BUDGET_MS,
  };

  it("1. the pass route declares a LIVE maxDuration of PASS_ROUTE_MAX_S, and each of the six budgets plus 30 s fits it (mutation: route literal 60, RELEASE_BUDGET_MS 61_000, or the export commented out → FAILS)", () => {
    expect(declaredMaxDuration(passRouteSource)).toBe(PASS_ROUTE_MAX_S);
    expect(Object.keys(BUDGETS_MS)).toHaveLength(6);
    for (const [name, ms] of Object.entries(BUDGETS_MS)) {
      expect(ms + 30_000, name).toBeLessThanOrEqual(PASS_ROUTE_MAX_S * 1000);
    }
  });

  it("2. every plan node's ceiling is the pass route's, except the jobs drain, which is its own route's", () => {
    for (const node of PLAN) {
      expect(node.ceilingS, node.key).toBe(node.key === JOBS_DRAIN_KEY ? JOBS_DRAIN_MAX_S : PASS_ROUTE_MAX_S);
    }
    expect(PLAN.some((n) => n.key === JOBS_DRAIN_KEY)).toBe(true);
  });

  it("3. the plan's longest path (760 s today: eight nodes of 90 + 5) plus the slack fits the dispatcher's LIVE maxDuration (mutation: PASS_ROUTE_MAX_S 120, or siteTraffic after reactivations → FAILS)", () => {
    // The number itself is asserted so a longer path is seen in review, not
    // only when it finally overflows: billingPause → releaseHeld → followups
    // → reviewRequests → referralAsks → reactivations → usageReport → opsWatch.
    expect(longestPathS(PLAN)).toBe(760);
    expect(longestPathS(PLAN) + DISPATCH_SLACK_S).toBeLessThanOrEqual(declaredMaxDuration(routeSource));
  });

  it("4. the dispatcher declares a LIVE maxDuration of DISPATCHER_MAX_S, shorter than one tick, so two dispatchers never overlap (mutation: literal 900, or the export commented out → FAILS)", () => {
    const entry = vercel.crons.find((c) => c.path === "/api/cron/reminders");
    expect(entry).toBeDefined();
    const declared = declaredMaxDuration(routeSource);
    expect(declared).toBe(DISPATCHER_MAX_S);
    expect(declared).toBeLessThan(tickIntervalMs(entry!.schedule) / 1000);
  });

  it("5. the row in flight past a budget ends inside the pass route, counting each pass's sends per row: budget + sends x (two attempts + one rate-limit wait) + 5 s ≤ 90 s (mutation: RATE_LIMIT_MAX_WAIT_MS 10_000, or SEND_TIMEOUT_MS 15_000 → FAILS)", () => {
    // A pass checks its budget BEFORE a row, so the row in flight can run
    // past it by every send that row makes. One send is at most attempt +
    // wait + attempt (Task 4): 23 s today. Five passes make ONE send per row
    // (or none), checked against their budget: 60 + 23 + 5 = 88 ≤ 90.
    const sendWorstMs = 2 * SEND_TIMEOUT_MS + RATE_LIMIT_MAX_WAIT_MS;
    const SENDS_PER_ROW = {
      RELEASE_BUDGET_MS: 1, USAGE_REPORT_BUDGET_MS: 1, DOCUMENT_SCAN_BUDGET_MS: 1,
      EXPIRY_BUDGET_MS: 1, CANCEL_NOTICE_BUDGET_MS: 1,
    } as const;
    for (const [name, sends] of Object.entries(SENDS_PER_ROW)) {
      const budget = BUDGETS_MS[name as keyof typeof BUDGETS_MS];
      expect(budget + sends * sendWorstMs + 5_000, name).toBeLessThanOrEqual(PASS_ROUTE_MAX_S * 1000);
    }
    // The weekly client report is the sixth, and the exception (Task 7
    // review, I1): ONE row (an account) makes one send PER RECIPIENT, up to
    // WEEKLY_REPORT_MAX_RECIPIENTS. Its budget alone cannot bound that
    // (60 + 3 x 23 = 129 s), so it starts an account only when every send
    // fits: elapsed + recipients x the send's worst case + the margin ≤ the
    // route's ceiling, which bounds the row by construction. Pinned here: the
    // pass's numbers ARE these, and an account at the cap fits from a
    // standing start (3 x 23 + 10 = 79 ≤ 90), so it is never stuck.
    expect(Object.keys(SENDS_PER_ROW).length + 1).toBe(Object.keys(BUDGETS_MS).length);
    expect(REPORT_EMAIL_WORST_CASE_MS).toBe(sendWorstMs);
    expect(WEEKLY_REPORT_ACCOUNT_END_MS).toBe(PASS_ROUTE_MAX_S * 1000);
    expect(WEEKLY_REPORT_MAX_RECIPIENTS * sendWorstMs + WEEKLY_REPORT_ACCOUNT_MARGIN_MS).toBeLessThanOrEqual(PASS_ROUTE_MAX_S * 1000);
  });

  it("6. the dispatcher's ceiling is inside the age a pass route accepts for the tick's now, so no pass the plan starts is refused as stale (mutation: TICK_NOW_MAX_AGE_MS 600_000 → FAILS)", () => {
    expect(DISPATCHER_MAX_S * 1000).toBeLessThanOrEqual(TICK_NOW_MAX_AGE_MS);
  });
});
