import { describe, it, expect } from "vitest";
import { REFERRAL_ASK_MAX_AGE_MS, REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import { shouldSendReferralAskNow, reviewRequestStillOwed } from "./referral-ask-gate";

const ZONE = "America/Chicago";
const WEST = "America/Los_Angeles";
/** 09:00 CDT Sept 24 · 07:00 PDT Sept 24 — inside the 08:00–11:00 band in
 *  Chicago and before it in Los Angeles. One instant, two verdicts. */
const NOW = new Date("2027-09-24T14:00:00.000Z");
/** The job ended 15:00 CDT Sept 21 — three local days earlier, 66h before NOW. */
const ANCHOR = new Date("2027-09-21T20:00:00.000Z");
/** Rung one, 09:00 CDT Sept 22. */
const FOLLOWUP = new Date("2027-09-22T14:00:00.000Z");
/** Rung two, 09:05 CDT Sept 23 — a DIFFERENT instant from FOLLOWUP on
 *  purpose: a fixture where both stamps share a value is satisfied by
 *  whichever clause survives a mutation, which is this repo's fixture-equal
 *  shape. */
const REVIEWED = new Date("2027-09-23T14:05:00.000Z");

const send = (over: Partial<{
  now: Date; anchor: Date; followup: Date | null; reviewed: Date | null; reviewOn: boolean; zone: string;
  skipBand: boolean;
}> = {}) => {
  const a = { now: NOW, anchor: ANCHOR, followup: FOLLOWUP, reviewed: REVIEWED, reviewOn: true, zone: ZONE, ...over };
  return shouldSendReferralAskNow(
    a.now, a.anchor, a.followup, a.reviewed, a.reviewOn, a.zone,
    a.skipBand === undefined ? undefined : { skipBand: a.skipBand });
};

describe("the referral ask is the ladder's third rung", () => {
  it("sends on the morning after the review request went out", () => {
    expect(send()).toBe(true);
  });

  it("does NOT send on the SAME morning the review request went out, and does the next", () => {
    // 09:30 CDT Sept 23 — the review stamp is 25 minutes old, same local day.
    expect(send({ now: new Date("2027-09-23T14:30:00.000Z") })).toBe(false);
    // Mutation: delete the reviewRequestedAt clause from
    // shouldSendReferralAskNow → this case goes red and the other stays green.
    expect(send()).toBe(true);
  });

  it("does NOT send on the same morning as the follow-up either", () => {
    expect(send({ now: new Date("2027-09-22T14:30:00.000Z"), reviewed: null, reviewOn: false })).toBe(false);
  });

  it("WAITS while the review request is still owed — precedence, not luck", () => {
    // review_request ON, never sent, anchor still inside its own 61h.
    const anchor = new Date("2027-09-23T20:00:00.000Z");                 // 15:00 CDT Sept 23
    const now = new Date("2027-09-24T14:00:00.000Z");                    // 09:00 CDT Sept 24, 18h later
    expect(shouldSendReferralAskNow(now, anchor, null, null, true, ZONE)).toBe(false);
    // Mutation: make reviewRequestEnabled unread (hard-code false inside the
    // gate) → this case goes red.
    expect(reviewRequestStillOwed(now, anchor, null, true)).toBe(true);
    // The same morning with review_request OFF: nothing to wait for.
    expect(shouldSendReferralAskNow(now, anchor, null, null, false, ZONE)).toBe(true);
  });

  it("stops waiting once the review request's own 61h has run out unsent", () => {
    // Anchor 61h + 1ms before NOW: the review can never go now, so the
    // referral stops deferring to it. Tested AT the bound and 1ms either side.
    const atBound = new Date(NOW.getTime() - REVIEW_REQUEST_MAX_AGE_MS);
    const pastBound = new Date(NOW.getTime() - REVIEW_REQUEST_MAX_AGE_MS - 1);
    expect(reviewRequestStillOwed(NOW, atBound, null, true)).toBe(true);
    expect(reviewRequestStillOwed(NOW, pastBound, null, true)).toBe(false);
    // Mutation: change the comparison to `<` → the at-bound row reds.
  });

  it("is too stale one millisecond past 85 hours, and fine AT 85 hours", () => {
    // THE LITERAL, NOT THE IMPORT, on both sides. `REFERRAL_ASK_MAX_AGE_MS`
    // is the gate's own threshold: build the fixtures from it and `at` is
    // false / `past` is true for ANY value it takes, so the mutation named
    // below could never red this. The import is pinned once, here, against
    // the number the recipe promises.
    const MAX = 85 * 60 * 60 * 1000;
    expect(REFERRAL_ASK_MAX_AGE_MS).toBe(MAX);
    const at = new Date(NOW.getTime() - MAX);
    const past = new Date(NOW.getTime() - MAX - 1);
    expect(send({ anchor: at, followup: null, reviewed: new Date(at.getTime() + 60_000), reviewOn: true })).toBe(true);
    expect(send({ anchor: past, followup: null, reviewed: new Date(past.getTime() + 60_000), reviewOn: true })).toBe(false);
    // Mutation: change REFERRAL_ASK_MAX_AGE_MS to 86h → `past` (85h + 1ms)
    // is no longer stale and the second line reds; change it to 84h and the
    // first reds. Either way this test names the drift.
  });

  /**
   * THE RELEASE PATH (audit B's I1). `skipBand` skips the morning BAND and
   * NOTHING ELSE — the spec's release contract, restated at line 16 and in
   * amendment B16. A held row passed the band once already; the staleness cap
   * and the never-two-rungs-on-one-morning rules have to be re-applied, or a
   * row held overnight goes out at noon on the same morning as the review
   * request it is supposed to follow.
   */
  it("with the band skipped, the same-morning review rule and the 85h cap still refuse", () => {
    const NOON = new Date("2027-09-24T17:00:00.000Z");    // 12:00 CDT — outside the band
    // The control: the band is the ONLY thing standing between this row and a
    // send, so skipping it sends. Without this line the three refusals below
    // would all be satisfied by a gate that always returned false.
    expect(send({ now: NOON })).toBe(false);
    expect(send({ now: NOON, skipBand: true })).toBe(true);

    // Rule 4 re-applied: the review request went out at 08:05 CDT THIS
    // morning. Mutation: have `skipBand` return early / skip the whole
    // composite (the shipped `if (!opts.released)` shape) → this reds.
    expect(send({ now: NOON, reviewed: new Date("2027-09-24T13:05:00.000Z"), skipBand: true })).toBe(false);

    // Rule 1 re-applied: one millisecond past 85 hours, measured from NOON.
    const MAX = 85 * 60 * 60 * 1000;
    const at = new Date(NOON.getTime() - MAX);
    const past = new Date(NOON.getTime() - MAX - 1);
    expect(send({ now: NOON, anchor: at, followup: null,
                  reviewed: new Date(at.getTime() + 60_000), skipBand: true })).toBe(true);
    expect(send({ now: NOON, anchor: past, followup: null,
                  reviewed: new Date(past.getTime() + 60_000), skipBand: true })).toBe(false);
  });

  it("is outside the morning band at 07:59 and inside at 08:00", () => {
    expect(send({ now: new Date("2027-09-24T12:59:00.000Z") })).toBe(false);   // 07:59 CDT
    expect(send({ now: new Date("2027-09-24T13:00:00.000Z") })).toBe(true);    // 08:00 CDT
    expect(send({ now: new Date("2027-09-24T16:00:00.000Z") })).toBe(false);   // 11:00 CDT
  });

  /**
   * ONE INSTANT, TWO ZONES, OPPOSITE VERDICTS — the house rule for every
   * zone-dependent test, stated at the top of `review-request-gate.test.ts:7-12`
   * and demonstrated at `:23-24`. Without this pair, a gate that ignored its
   * `timezone` argument entirely would pass every other case in this file,
   * because they all pin America/Chicago, which is this machine's zone.
   * 14:00Z is 09:00 in Chicago (inside the 08:00–11:00 band) and 07:00 in
   * Los Angeles (before it); the anchor, both stamps and the instant are
   * identical.
   */
  it("reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles", () => {
    expect(send()).toBe(true);
    expect(send({ zone: WEST })).toBe(false);
    // Mutation: hard-code `"America/Chicago"` inside shouldSendReferralAskNow
    // instead of reading `timezone` → the second line reds.
  });

  it("fails CLOSED on an unresolvable zone, a negative elapsed time and an unreadable stamp — and an explicit UTC account still works", () => {
    // THE JUNK LIST IS THE THREE SIBLING GATES' LIST, verbatim
    // (`review-request-gate.test.ts:34-37`, `no-show-nudge-gate.test.ts:34`,
    // `followup-timing.test.ts:196`). NOT `"CST"`: `resolveAccountZone` is
    // `safeZone(tz, ZONE_UNRESOLVABLE)` and `safeZone`'s whole validation is
    // "did `new Intl.DateTimeFormat` throw" (`lib/booking/time.ts:20-30`,
    // `followup-timing.ts:122-125`). ICU RESOLVES `CST` — to America/Chicago,
    // verified — so asserting `false` for it would fail against a CORRECT
    // gate and invite an implementer to weaken the fail-closed rule to make
    // it pass. (`followup-timing.ts:110` names "the operator typed CST" as
    // the bug it was written for; the fix was the sentinel fallback, not a
    // claim that ICU rejects the string.)
    const utcMorning = new Date("2027-09-24T09:30:00.000Z");   // 09:30 UTC, inside the band
    expect(send({ now: utcMorning, zone: "UTC" })).toBe(true);  // the positive control
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(send({ now: utcMorning, zone: junk }), junk).toBe(false);
      // Release path too: a junk zone is still no hour even with the band
      // skipped. followup/reviewed/reviewOn neutralised so this isolates the
      // zone check from rules 4 and 5's OWN independent refusals. Mutation:
      // hoist the whole zone-dependent chain (rule 2's band AND rule 3's
      // strictly-earlier-day check on the anchor) inside `if (!opts.skipBand)
      // { ... }` -> this reds. (Hoisting the null-check alone does not: rule
      // 3's `isStrictlyEarlierLocalDay` re-resolves and re-guards the zone on
      // its own, unlike `quote-followup-gate.ts`, which has no second
      // zone-dependent check to fall back on.)
      expect(send({
        now: utcMorning, zone: junk, skipBand: true,
        followup: null, reviewed: null, reviewOn: false,
      }), junk).toBe(false);
    }
    expect(send({ anchor: new Date(NOW.getTime() + 3600_000) })).toBe(false);
    expect(send({ reviewed: new Date("nonsense") })).toBe(false);
    expect(send({ followup: new Date("nonsense") })).toBe(false);
  });
});
