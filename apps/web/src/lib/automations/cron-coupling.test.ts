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
import { reminderDeadline } from "@/lib/booking/reminder-timing";
import { nextOpening, expiresBeforeOpening } from "@/lib/consent/hours";
import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import { RELEASE_BUDGET_MS } from "./passes/release-held";

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

function tickIntervalMs(schedule: string): number {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(schedule);
  if (!m) throw new Error(`schedule is not of the form "*/N * * * *": ${schedule}`);
  return Number(m[1]) * MINUTE;
}

describe("the cron schedule and the query windows are coupled — enforced, not described", () => {
  const entry = vercel.crons.find((c) => c.path === "/api/cron/reminders");

  it("vercel.json has exactly one cron entry, and it is the reminders route", () => {
    expect(vercel.crons).toHaveLength(1);
    expect(entry).toBeDefined();
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
          reminderDeadline({ startsAt, late: true }), Math.max(b, s - LATE_REMINDER_WINDOW_END_MS), s);
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

  it("the route declares a LIVE maxDuration at least double the release pass's own wall-clock budget — the budget bounds the FIRST pass, and the rest of the tick belongs to the passes after it (mutation: comment the export out, or delete it, or set it to 61 → each FAILS)", () => {
    // Anchored to a whole line (^…$, multiline) so a COMMENTED-OUT export
    // ("// export const maxDuration = 300;") cannot match — the regex used
    // to be bare `export const maxDuration = (\d+);`, which `.exec` finds
    // anywhere in the file including inside a `//` comment, so Vercel could
    // silently fall back to its inherited default while this test stayed green.
    const m = /^export const maxDuration = (\d+);$/m.exec(routeSource);
    expect(m).not.toBeNull();
    const maxDuration = Number(m![1]);
    // At LEAST double: 61s (one second of headroom) would still pass a
    // ">" check but leaves nothing for the passes that run after the release
    // pass in the same tick. No count in the prose: `PASSES` grows by a line
    // per recipe (it is thirteen entries today, and was nine when this
    // sentence was written), and a number written down here rots silently.
    expect(maxDuration).toBeGreaterThanOrEqual((RELEASE_BUDGET_MS / 1000) * 2);
  });
});
