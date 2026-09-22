import { describe, it, expect } from "vitest";
import { QUOTE_FOLLOWUP_MAX_AGE_MS } from "@bis/db";
import { shouldSendQuoteFollowupNow } from "./quote-followup-gate";

const ZONE = "America/Chicago";
const WEST = "America/Los_Angeles";
const NOW = new Date("2027-10-20T14:00:00.000Z");   // 09:00 CDT · 07:00 PDT
const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("when a quote follow-up may go", () => {
  it("goes once the deal has sat for the configured days, and not a minute before", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(3 * DAY), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(NOW, ago(3 * DAY - 60_000), 3, ZONE)).toBe(false);
    // One minute inside the bound, not "yesterday". Mutation: change the gate's
    // `if (elapsedMs < quietDays * DAY_MS)` to `<=` -> the at-bound row reds and
    // nothing else moves. (There is no `>=` in this gate to flip; naming one
    // sends an implementer mutating the max-age instead, which reds a
    // different test and passes this one.)
  });

  /**
   * ONE INSTANT, TWO ZONES, OPPOSITE VERDICTS - the house rule for every
   * zone-dependent test (`review-request-gate.test.ts:7-13` states it, `:59-61`
   * demonstrates it). Without the pair, a gate that ignored its `timezone` argument
   * entirely would pass every other case in this file. 14:00Z is 09:00 in
   * Chicago (inside the 08:00-11:00 band) and 07:00 in Los Angeles (before it),
   * and the deal, the quiet days and the instant are identical.
   *
   * Mutation: hard-code `"America/Chicago"` inside the gate instead of reading
   * the argument -> the second line reds.
   */
  it("reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(5 * DAY), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(NOW, ago(5 * DAY), 3, WEST)).toBe(false);
  });

  it("is too stale one millisecond past thirty days, and fine AT thirty days", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(QUOTE_FOLLOWUP_MAX_AGE_MS), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(NOW, ago(QUOTE_FOLLOWUP_MAX_AGE_MS + 1), 3, ZONE)).toBe(false);
  });

  it("respects the morning band at both edges", () => {
    expect(shouldSendQuoteFollowupNow(new Date("2027-10-20T12:59:00Z"), ago(5 * DAY), 3, ZONE)).toBe(false);
    expect(shouldSendQuoteFollowupNow(new Date("2027-10-20T13:00:00Z"), ago(5 * DAY), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(new Date("2027-10-20T16:00:00Z"), ago(5 * DAY), 3, ZONE)).toBe(false);
  });

  it("fails CLOSED on an unresolvable zone, a future stage change and an unreadable instant - and an explicit UTC account still works", () => {
    // THE JUNK LIST IS THE THREE SIBLING GATES' LIST, verbatim
    // (`review-request-gate.test.ts:34-37`, `no-show-nudge-gate.test.ts:34`,
    // `followup-timing.test.ts:196`). NOT `"CST"`: `resolveAccountZone` is
    // `safeZone(tz, ZONE_UNRESOLVABLE)` and `safeZone`'s whole validation is
    // "did `new Intl.DateTimeFormat` throw" (`lib/booking/time.ts:20-30`,
    // `followup-timing.ts:122-125`). ICU RESOLVES `CST` - to America/Chicago,
    // verified - so asserting `false` for it would fail against a CORRECT gate
    // and invite an implementer to weaken the fail-closed rule to make it pass.
    // (`followup-timing.ts:110` names "the operator typed CST" as the bug it
    // was written for; the fix was the sentinel fallback, not a claim that ICU
    // rejects the string.)
    expect(shouldSendQuoteFollowupNow(NOW, ago(5 * DAY), 3, "UTC")).toBe(false); // 14:00 UTC - outside the band, not unresolvable
    const utcMorning = new Date("2027-10-20T09:30:00.000Z");
    expect(shouldSendQuoteFollowupNow(utcMorning, ago(5 * DAY), 3, "UTC")).toBe(true);   // the positive control
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendQuoteFollowupNow(utcMorning, ago(5 * DAY), 3, junk), junk).toBe(false);
    }
    expect(shouldSendQuoteFollowupNow(NOW, new Date(NOW.getTime() + DAY), 3, ZONE)).toBe(false);
    expect(shouldSendQuoteFollowupNow(NOW, new Date("nonsense"), 3, ZONE)).toBe(false);
  });
});
