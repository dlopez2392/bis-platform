import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
  REVIEW_REQUEST_MAX_AGE_MS, NO_SHOW_NUDGE_MAX_AGE_MS,
  SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
} from "@bis/db";
import { FOLLOWUP_MAX_AGE_MS } from "@/lib/booking/followup-timing";
import { SMS_RETRY_COOLDOWN_MS } from "./caps";

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

  it("the SMS reminder window is wider than one tick, and fires about two hours ahead", () => {
    // Mutation: change either constant alone.
    const tick = tickIntervalMs(entry!.schedule);
    expect(SMS_REMINDER_WINDOW_END_MS - SMS_REMINDER_WINDOW_START_MS).toBeGreaterThan(tick);
    expect(SMS_REMINDER_WINDOW_END_MS).toBe(135 * MINUTE);
    expect(SMS_REMINDER_WINDOW_START_MS).toBe(90 * MINUTE);
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
    const tick = tickIntervalMs(entry!.schedule);
    expect((SMS_REMINDER_WINDOW_END_MS - SMS_REMINDER_WINDOW_START_MS) / tick).toBe(3);
  });
});
