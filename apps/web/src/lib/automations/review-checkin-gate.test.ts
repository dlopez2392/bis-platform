import { describe, it, expect } from "vitest";
import { REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import { nextOpening } from "@/lib/consent/hours";
import { shouldSendCheckinNow, CHECKIN_DELAY_MS, CHECKIN_MAX_AGE_MS } from "./review-checkin-gate";

/**
 * The check-in's moment: two hours after the anchor, no morning band, no deferral to the calendar follow-up.
 * The sending hours are NOT here: the consent chain holds an automated email outside 08:00 to 21:00 in the
 * account's zone and the release pass sends it at the opening (hold-or-send.ts).
 */
const NY = "America/New_York";
const CHI = "America/Chicago";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ANCHOR = new Date("2026-09-09T15:00:00Z");

describe("shouldSendCheckinNow: two hours after the anchor, and not before", () => {
  it("1 h 59 m after the anchor sends nothing; exactly 2 h sends (mutation: 2 h -> 0 -> the 1 h 59 m case FAILS)", () => {
    expect(shouldSendCheckinNow(new Date(ANCHOR.getTime() + 2 * HOUR - MIN), ANCHOR, NY)).toBe(false);
    expect(shouldSendCheckinNow(new Date(ANCHOR.getTime() + 2 * HOUR), ANCHOR, NY)).toBe(true);
  });

  it("a meeting that has not ended (a negative elapsed) and an unreadable instant never send", () => {
    expect(shouldSendCheckinNow(new Date(ANCHOR.getTime() - HOUR), ANCHOR, NY)).toBe(false);
    expect(shouldSendCheckinNow(new Date("nope"), ANCHOR, NY)).toBe(false);
    expect(shouldSendCheckinNow(new Date(ANCHOR.getTime() + 3 * HOUR), new Date("nope"), NY)).toBe(false);
  });

  it("has no morning band: an afternoon tick and a 3 a.m. tick both pass, the hours are the consent chain's", () => {
    // NY 15:00 (afternoon), and NY 03:00 two hours after an anchor at 01:00.
    expect(shouldSendCheckinNow(new Date("2026-09-09T19:00:00Z"), new Date("2026-09-09T17:00:00Z"), NY)).toBe(true);
    expect(shouldSendCheckinNow(new Date("2026-09-09T07:00:00Z"), new Date("2026-09-09T05:00:00Z"), NY)).toBe(true);
  });

  it("does not wait for a later local day than the anchor (the review request's rule 3 is not here)", () => {
    // Same local day, three hours apart.
    expect(shouldSendCheckinNow(new Date("2026-09-09T18:00:00Z"), ANCHOR, NY)).toBe(true);
  });
});

describe("shouldSendCheckinNow: the zone must resolve, else it fails closed", () => {
  const LATER = new Date(ANCHOR.getTime() + 3 * HOUR);
  it("sends for a real zone and for explicit UTC; refuses every unresolvable one", () => {
    expect(shouldSendCheckinNow(LATER, ANCHOR, CHI)).toBe(true);
    expect(shouldSendCheckinNow(LATER, ANCHOR, "UTC")).toBe(true);
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendCheckinNow(LATER, ANCHOR, junk)).toBe(false);
    }
  });
});

describe("CHECKIN_MAX_AGE_MS: 36 hours, derived", () => {
  it("is 36 h and the delay is 2 h", () => {
    expect(CHECKIN_DELAY_MS).toBe(2 * HOUR);
    expect(CHECKIN_MAX_AGE_MS).toBe(36 * HOUR);
  });

  it("is the last instant it sends: 36 h sends, one minute past does not", () => {
    expect(shouldSendCheckinNow(new Date(ANCHOR.getTime() + CHECKIN_MAX_AGE_MS), ANCHOR, NY)).toBe(true);
    expect(shouldSendCheckinNow(new Date(ANCHOR.getTime() + CHECKIN_MAX_AGE_MS + MIN), ANCHOR, NY)).toBe(false);
  });

  it("fits inside the due-list's window, so the list never drops a row the gate would still send", () => {
    expect(CHECKIN_MAX_AGE_MS).toBeLessThanOrEqual(REVIEW_REQUEST_MAX_AGE_MS);
  });

  /**
   * THE WORST HOLD, with a real zone and a real clock change. A job marked completed in Chicago at 19:01 on Oct 31
   * 2026 (CDT) is due at 21:01, after the sending hours close at 21:00, so it waits for 08:00 on Nov 1, which is
   * AFTER the fall-back (CST), a 25-hour local day. The opening is read from the consent chain's own rule, not
   * restated here, and the send must still sit well inside the cap.
   */
  it("a job completed at 19:01 Chicago on the night the clocks fall back is held to 08:00 CST and still sent with hours to spare", () => {
    const completed = new Date("2026-11-01T00:01:00Z");           // Sat Oct 31 19:01 CDT
    const dueAt = new Date(completed.getTime() + CHECKIN_DELAY_MS); // 21:01 CDT, hours closed
    const opening = nextOpening("automated", dueAt, CHI);
    expect(opening?.toISOString()).toBe("2026-11-01T14:00:00.000Z"); // Sun Nov 1 08:00 CST
    const held = opening!.getTime() - completed.getTime();
    expect(held).toBe(13 * HOUR + 59 * MIN);
    expect(shouldSendCheckinNow(opening!, completed, CHI)).toBe(true);
    // The margin the 36 h leaves for the caps and a failed tick: more than twenty hours.
    expect(CHECKIN_MAX_AGE_MS - held).toBeGreaterThan(20 * HOUR);
  });
});
