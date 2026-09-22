import { describe, it, expect } from "vitest";
import { shouldSendReactivationNow } from "./reactivation-gate";

const ZONE = "America/Chicago";
const WEST = "America/Los_Angeles";
describe("when a reactivation email may go", () => {
  it("is inside the morning band at 08:00 and 10:59, outside at 07:59 and 11:00", () => {
    expect(shouldSendReactivationNow(new Date("2027-09-21T12:59:00Z"), ZONE)).toBe(false);  // 07:59
    expect(shouldSendReactivationNow(new Date("2027-09-21T13:00:00Z"), ZONE)).toBe(true);   // 08:00
    expect(shouldSendReactivationNow(new Date("2027-09-21T15:59:00Z"), ZONE)).toBe(true);   // 10:59
    expect(shouldSendReactivationNow(new Date("2027-09-21T16:00:00Z"), ZONE)).toBe(false);  // 11:00
    // Mutation: widen the band by an hour → the 07:59 or the 11:00 row reds.
  });

  /**
   * ONE INSTANT, TWO ZONES, OPPOSITE VERDICTS — the house rule for every
   * zone-dependent test (`review-request-gate.test.ts:7-12` states it,
   * `:23-24` demonstrates it). Without it, every case in this file pins
   * America/Chicago, which is this machine's zone, and a gate that ignored
   * its `timezone` argument entirely would pass all of them. 13:00Z is 08:00
   * in Chicago (the band's first minute) and 06:00 in Los Angeles.
   */
  it("reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles", () => {
    const instant = new Date("2027-09-21T13:00:00Z");
    expect(shouldSendReactivationNow(instant, ZONE)).toBe(true);
    expect(shouldSendReactivationNow(instant, WEST)).toBe(false);
    // Mutation: hard-code `"America/Chicago"` inside the gate → the second
    // line reds.
  });

  it("fails CLOSED on a zone Intl cannot resolve, and on an unreadable instant — and an explicit UTC account still works", () => {
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
    const utcMorning = new Date("2027-09-21T09:30:00Z");
    expect(shouldSendReactivationNow(utcMorning, "UTC")).toBe(true);           // the positive control
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendReactivationNow(utcMorning, junk), junk).toBe(false);
    }
    expect(shouldSendReactivationNow(new Date("nonsense"), ZONE)).toBe(false);
  });
});
