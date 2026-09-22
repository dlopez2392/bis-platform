import { describe, it, expect } from "vitest";
import { NO_SHOW_NUDGE_MAX_AGE_MS, FOLLOWUP_QUERY_WINDOW_MS } from "@bis/db";
import { laterOf } from "./anchor";
import { shouldSendNoShowNudgeNow } from "./no-show-nudge-gate";

/**
 * Same rules as review-request-gate.test.ts: every instant computed with
 * Intl before the assertion was written; every zone-dependent test pins ONE
 * instant against TWO zones with OPPOSITE verdicts; America/Chicago only as
 * one half of a pair.
 */
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const CHI = "America/Chicago";
const HOUR = 60 * 60 * 1000;

describe("shouldSendNoShowNudgeNow — the morning after, in the account's zone", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");       // NY 10:00 · LA 07:00
  const ANCHOR = new Date("2026-09-08T20:30:00Z");    // NY Tue 16:30 · LA Tue 13:30

  it("sends where it is mid-morning, holds where it is still dawn", () => {
    expect(shouldSendNoShowNudgeNow(NOW, ANCHOR, NY)).toBe(true);
    expect(shouldSendNoShowNudgeNow(NOW, ANCHOR, LA)).toBe(false);
  });

  it("never sends for an anchor in the future, and never on the same local day", () => {
    expect(shouldSendNoShowNudgeNow(NOW, new Date("2026-09-09T18:00:00Z"), NY)).toBe(false);
    expect(shouldSendNoShowNudgeNow(NOW, new Date("2026-09-09T12:30:00Z"), NY)).toBe(false);   // marked 08:30 today
  });

  it("fails closed on an unresolvable zone; an explicit UTC account still works", () => {
    const utcMorning = new Date("2026-09-09T09:30:00Z");
    expect(shouldSendNoShowNudgeNow(utcMorning, ANCHOR, "UTC")).toBe(true);
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendNoShowNudgeNow(utcMorning, ANCHOR, junk)).toBe(false);
    }
  });

  it("one 'Mark no-show' instant, two zones: 23:30 yesterday in Chicago sends, 00:30 today in New York holds", () => {
    // The operator closing the books at midnight — the case the morning band
    // exists for. Mutation: compare instants instead of local days.
    const ENDED = new Date("2026-09-08T20:30:00Z");
    const MARKED = new Date("2026-09-09T04:30:00Z");  // NY Wed 00:30 · CHI Tue 23:30
    expect(shouldSendNoShowNudgeNow(NOW, laterOf(ENDED, MARKED), CHI)).toBe(true);
    expect(shouldSendNoShowNudgeNow(NOW, laterOf(ENDED, MARKED), NY)).toBe(false);
  });
});

/**
 * THE RELEASE PATH. `skipBand` skips the morning BAND and NOTHING ELSE — the
 * release contract (part B's spec, line 16, and amendment B16). A held row
 * passed the band once, at the hour it was held, and comes back at the quiet
 * window's end, which is by definition not a band hour. The 37h cap and the
 * strictly-earlier-local-day rule ARE re-applied, because a booking
 * un-completed and re-marked no-show DURING the hold hands the releaser a
 * brand-new anchor, and nothing else on that path would notice.
 *
 * Mutation for this block: hoist `if (opts.skipBand) return true;` to the top
 * of `shouldSendNoShowNudgeNow` → every case below but the control reds.
 */
describe("shouldSendNoShowNudgeNow — the release path skips the band ALONE", () => {
  const NOON_NY = new Date("2026-09-09T16:00:00Z");   // NY Wed 12:00 · LA Wed 09:00
  const ANCHOR = new Date("2026-09-08T20:30:00Z");    // NY Tue 16:30 · LA Tue 13:30

  it("sends at noon when the band was the only rule refusing — the control for the three below", () => {
    expect(shouldSendNoShowNudgeNow(NOON_NY, ANCHOR, NY)).toBe(false);
    expect(shouldSendNoShowNudgeNow(NOON_NY, ANCHOR, NY, { skipBand: true })).toBe(true);
  });

  it("re-applies the 37h cap on release: at the bound it goes, one millisecond past it does not", () => {
    const at = new Date(NOON_NY.getTime() - NO_SHOW_NUDGE_MAX_AGE_MS);   // NY Mon 23:00
    const past = new Date(at.getTime() - 1);
    expect(shouldSendNoShowNudgeNow(NOON_NY, at, NY, { skipBand: true })).toBe(true);
    expect(shouldSendNoShowNudgeNow(NOON_NY, past, NY, { skipBand: true })).toBe(false);
  });

  it("re-applies the strictly-earlier-local-day rule on release — one instant, two zones, opposite verdicts", () => {
    // "Mark no-show" pressed again during the hold: laterOf hands the pass an
    // anchor that is TODAY, and nobody gets texted about this morning's job.
    const MARKED = new Date("2026-09-09T05:30:00Z");   // NY Wed 01:30 (today) · LA Tue 22:30 (yesterday)
    expect(shouldSendNoShowNudgeNow(NOON_NY, laterOf(ANCHOR, MARKED), NY, { skipBand: true })).toBe(false);
    expect(shouldSendNoShowNudgeNow(NOON_NY, laterOf(ANCHOR, MARKED), LA, { skipBand: true })).toBe(true);
  });

  it("still fails closed on an unresolvable zone: a release with no zone is still no hour", () => {
    for (const junk of ["Mars/Olympus", "", "  ", "America/Nowhere"]) {
      expect(shouldSendNoShowNudgeNow(NOON_NY, ANCHOR, junk, { skipBand: true })).toBe(false);
    }
  });
});

describe("shouldSendNoShowNudgeNow — the 37h cap, pinned against real zones", () => {
  it("is exactly the follow-up window: same derivation, nothing to defer to", () => {
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(37 * HOUR);
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(FOLLOWUP_QUERY_WINDOW_MS);
  });

  it("treats the boundary as still-sendable, one millisecond past it as stale", () => {
    const now = new Date("2026-09-09T09:30:00Z");
    expect(shouldSendNoShowNudgeNow(now, new Date(now.getTime() - NO_SHOW_NUDGE_MAX_AGE_MS), "UTC")).toBe(true);
    expect(shouldSendNoShowNudgeNow(now, new Date(now.getTime() - NO_SHOW_NUDGE_MAX_AGE_MS - 1), "UTC")).toBe(false);
  });

  /**
   * THE DERIVATION, as a test. Antarctica/Troll falls back TWO hours on
   * 2026-10-25, making that local day 26 hours long. An anchor at 00:00
   * local that day is the worst case; the band on Monday is 08:00–11:00,
   * and its last qualifying instant is 37h after the anchor. Mutation: 36h
   * and `justInsideTheBand` fails while `bandOpens` still passes.
   */
  it("covers the true worst case: a 26-hour local day, then the morning band on D+1", () => {
    const anchorAtLocalMidnight = new Date("2026-10-24T22:00:00Z");  // Troll 00:00 Sun Oct 25
    const bandOpens = new Date("2026-10-26T08:00:00Z");              // Troll 08:00 Mon Oct 26
    const bandCloses = new Date("2026-10-26T11:00:00Z");             // Troll 11:00 Mon Oct 26
    const Z = "Antarctica/Troll";
    expect(bandCloses.getTime() - anchorAtLocalMidnight.getTime()).toBe(NO_SHOW_NUDGE_MAX_AGE_MS);
    expect(shouldSendNoShowNudgeNow(bandOpens, anchorAtLocalMidnight, Z)).toBe(true);
    expect(shouldSendNoShowNudgeNow(bandCloses, anchorAtLocalMidnight, Z)).toBe(false);   // the band's exclusive edge
    expect(shouldSendNoShowNudgeNow(new Date(bandCloses.getTime() - 60 * 1000), anchorAtLocalMidnight, Z)).toBe(true);
  });
});
