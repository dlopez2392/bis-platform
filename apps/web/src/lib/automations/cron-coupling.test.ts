import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
  REVIEW_REQUEST_MAX_AGE_MS, NO_SHOW_NUDGE_MAX_AGE_MS, REFERRAL_ASK_MAX_AGE_MS,
  SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
  APPOINTMENT_CONFIRM_WINDOW_START_MS, APPOINTMENT_CONFIRM_WINDOW_END_MS,
  APPOINTMENT_CONFIRM_MIN_LEAD_MS,
} from "@bis/db";
import { FOLLOWUP_MAX_AGE_MS } from "@/lib/booking/followup-timing";
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
