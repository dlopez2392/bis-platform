import { describe, it, expect } from "vitest";
import { REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import { FOLLOWUP_MAX_AGE_MS } from "@/lib/booking/followup-timing";
import { shouldSendReviewRequestNow } from "./review-request-gate";
import { laterOf } from "./anchor";

/**
 * Same rules as followup-timing.test.ts: every instant computed with Intl
 * before the assertion was written; every zone-dependent test pins ONE
 * instant against TWO zones with OPPOSITE verdicts; America/Chicago (this
 * machine's zone) appears only as one half of a pair.
 */
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const CHI = "America/Chicago";
const HOUR = 60 * 60 * 1000;

describe("shouldSendReviewRequestNow — the morning band, in the account's zone", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");     // NY 10:00 · LA 07:00
  const ENDED = new Date("2026-09-08T22:00:00Z");   // NY Tue 18:00 · LA Tue 15:00

  it("sends where it is mid-morning, holds where it is still dawn — with no follow-up to defer to", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, NY)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, LA)).toBe(false);
  });

  it("never sends for a meeting that has not ended, and never on the same local day", () => {
    expect(shouldSendReviewRequestNow(NOW, new Date("2026-09-09T18:00:00Z"), null, NY)).toBe(false);
    expect(shouldSendReviewRequestNow(NOW, new Date("2026-09-09T13:00:00Z"), null, NY)).toBe(false); // ended 09:00 today
  });

  it("fails closed on an unresolvable zone, an explicit UTC account still works", () => {
    const utcMorning = new Date("2026-09-09T09:30:00Z");
    expect(shouldSendReviewRequestNow(utcMorning, ENDED, null, "UTC")).toBe(true);
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendReviewRequestNow(utcMorning, ENDED, null, junk)).toBe(false);
    }
  });
});

describe("shouldSendReviewRequestNow — THE COLLISION: defers to the calendar follow-up", () => {
  /**
   * The follow-up email already fires the morning after a completed meeting.
   * The review request may go out only on a strictly LATER local day than
   * `followup_sent_at`, so the two never land the same morning. ONE stamp
   * instant, two zones an hour apart, and that hour moves the stamp across
   * local midnight:
   *   Chicago  : stamped 23:30 YESTERDAY → earlier local day → send
   *   New_York : stamped 00:30 TODAY     → same local day    → hold
   * Both are mid-morning (09:00 and 10:00) with a meeting that ended the
   * previous evening, so ONLY the stamp's local day separates the verdicts.
   * Mutation: compare instants (`followupSentAt < now`) instead of local
   * days and both halves answer true.
   */
  const NOW = new Date("2026-09-09T14:00:00Z");           // NY Wed 10:00 · CHI Wed 09:00
  const ENDED = new Date("2026-09-08T22:00:00Z");         // NY Tue 18:00 · CHI Tue 17:00
  const STAMPED = new Date("2026-09-09T04:30:00Z");       // NY Wed 00:30 · CHI Tue 23:30

  it("sends where the follow-up went out yesterday, holds where it went out today", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, STAMPED, CHI)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, ENDED, STAMPED, NY)).toBe(false);
  });

  it("a null stamp (no follow-up ever sent) does not defer", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, CHI)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, NY)).toBe(true);
  });

  it("an unparseable stamp fails closed rather than sending", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, new Date("nope"), NY)).toBe(false);
  });
});

describe("shouldSendReviewRequestNow — the 61h staleness cap, pinned against real zones", () => {
  it("is exactly the follow-up cap plus one local day", () => {
    expect(REVIEW_REQUEST_MAX_AGE_MS).toBe(61 * HOUR);
    expect(REVIEW_REQUEST_MAX_AGE_MS).toBe(FOLLOWUP_MAX_AGE_MS + 24 * HOUR);
  });

  it("treats the boundary as still-sendable, one millisecond past it as stale", () => {
    // UTC keeps the arithmetic honest: 09:30 UTC is inside the band and both
    // meeting ends land on strictly earlier UTC days.
    const now = new Date("2026-09-09T09:30:00Z");
    const exactlyAtCap = new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS);
    const oneMsPastCap = new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS - 1);
    expect(shouldSendReviewRequestNow(now, exactlyAtCap, null, "UTC")).toBe(true);
    expect(shouldSendReviewRequestNow(now, oneMsPastCap, null, "UTC")).toBe(false);
  });

  /**
   * THE DERIVATION, as a test. Antarctica/Troll falls back TWO hours on
   * 2026-10-25, making that local day 26 hours long. A meeting ending at
   * 00:00 local that day is the worst case; the follow-up goes out at the
   * very close of Monday's band (10:59); the review request's own band is
   * Tuesday 08:00-11:00, and its last qualifying instant is 61h after the
   * meeting ended. Mutation: 60h and the `bandOpens` assertion still passes
   * but `justInsideTheBand` fails.
   */
  it("covers the true worst case: a 26-hour local day, then a follow-up at the close of D+1", () => {
    const endedAtLocalMidnight = new Date("2026-10-24T22:00:00Z");  // Troll 00:00 Sun Oct 25
    const followupAtBandClose = new Date("2026-10-26T10:59:00Z");   // Troll 10:59 Mon Oct 26
    const bandOpens = new Date("2026-10-27T08:00:00Z");             // Troll 08:00 Tue Oct 27
    const bandCloses = new Date("2026-10-27T11:00:00Z");            // Troll 11:00 Tue Oct 27
    const Z = "Antarctica/Troll";

    expect(bandCloses.getTime() - endedAtLocalMidnight.getTime()).toBe(REVIEW_REQUEST_MAX_AGE_MS);
    expect(shouldSendReviewRequestNow(bandOpens, endedAtLocalMidnight, followupAtBandClose, Z)).toBe(true);
    // The band's own exclusive upper edge stops it, not the cap.
    expect(shouldSendReviewRequestNow(bandCloses, endedAtLocalMidnight, followupAtBandClose, Z)).toBe(false);
    const justInsideTheBand = new Date(bandCloses.getTime() - 60 * 1000);
    expect(shouldSendReviewRequestNow(justInsideTheBand, endedAtLocalMidnight, followupAtBandClose, Z)).toBe(true);
    // And on Monday itself — the follow-up's morning — it holds.
    expect(shouldSendReviewRequestNow(new Date("2026-10-26T09:00:00Z"), endedAtLocalMidnight, followupAtBandClose, Z)).toBe(false);
  });

  it("covers the ordinary US fall-back case comfortably, at 57 hours", () => {
    const endedAtLocalMidnight = new Date("2026-11-01T04:00:00Z");  // NY 00:00 EDT Sun Nov 1
    const followupNextMorning = new Date("2026-11-02T13:30:00Z");   // NY 08:30 EST Mon Nov 2
    const reviewMorning = new Date("2026-11-03T13:00:00Z");         // NY 08:00 EST Tue Nov 3
    expect(reviewMorning.getTime() - endedAtLocalMidnight.getTime()).toBe(57 * HOUR);
    expect(shouldSendReviewRequestNow(reviewMorning, endedAtLocalMidnight, followupNextMorning, NY)).toBe(true);
  });
});

describe("shouldSendReviewRequestNow — the clock runs from laterOf(ends_at, completed_at)", () => {
  /**
   * The batch-Friday case that motivated 0026: a job that ended Monday and
   * was marked completed Friday afternoon. From ends_at it is 4½ days stale
   * and the cap drops it; from completed_at it is Saturday morning's
   * business. Mutation: pass `ENDED` instead of the anchor in the pass.
   */
  const ENDED_MONDAY = new Date("2026-08-31T22:00:00Z");     // NY Mon 18:00
  const COMPLETED_FRIDAY = new Date("2026-09-04T20:00:00Z"); // NY Fri 16:00
  const SATURDAY_MORNING = new Date("2026-09-05T14:00:00Z"); // NY Sat 10:00

  it("a job completed days after it ended is due the morning after completion, not dropped as stale", () => {
    expect(shouldSendReviewRequestNow(SATURDAY_MORNING, ENDED_MONDAY, null, NY)).toBe(false);
    expect(shouldSendReviewRequestNow(SATURDAY_MORNING, laterOf(ENDED_MONDAY, COMPLETED_FRIDAY), null, NY)).toBe(true);
  });

  it("a job completed THIS morning holds until tomorrow even though the meeting ended yesterday", () => {
    const NOW = new Date("2026-09-09T14:00:00Z");              // NY Wed 10:00
    const ENDED = new Date("2026-09-08T22:00:00Z");            // NY Tue 18:00
    const COMPLETED_TODAY = new Date("2026-09-09T12:30:00Z");  // NY Wed 08:30
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, NY)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, laterOf(ENDED, COMPLETED_TODAY), null, NY)).toBe(false);
  });

  it("one completion instant, two zones, opposite verdicts — the stamp's LOCAL day is what counts", () => {
    const NOW = new Date("2026-09-09T14:00:00Z");              // NY Wed 10:00 · CHI Wed 09:00
    const ENDED = new Date("2026-09-08T20:00:00Z");            // NY Tue 16:00
    const COMPLETED = new Date("2026-09-09T04:30:00Z");        // NY Wed 00:30 · CHI Tue 23:30
    expect(shouldSendReviewRequestNow(NOW, laterOf(ENDED, COMPLETED), null, CHI)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, laterOf(ENDED, COMPLETED), null, NY)).toBe(false);
  });
});
