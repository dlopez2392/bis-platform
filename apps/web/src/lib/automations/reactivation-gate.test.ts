import { describe, it, expect } from "vitest";
import { missingForReactivation as fromDb } from "@bis/db";
import { shouldSendReactivationNow, missingForReactivation } from "./reactivation-gate";

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

/**
 * WHAT the reactivation email cannot go without (decision A, 2026-09-22): a
 * postal address for its footer, and a reply-to so the "reply and let us
 * know" opt-out reaches the business rather than the agency's `EMAIL_FROM`
 * mailbox. The due-list walk, the pass, the save action and the card all ask
 * ONE function, so "blank" is decided once. Its home is `@bis/db`
 * (`automations.ts`), because the walk lives there and packages/db cannot
 * import web; this module re-exports it, and these cases run against the
 * re-export.
 */
describe("what a reactivation email cannot go without", () => {
  it("is ONE function: this module re-exports the @bis/db rule, it does not carry a copy", () => {
    // Mutation: replace the re-export with a local function of the same body
    // → this reds BY NAME, and the walk and the pass can drift apart.
    expect(missingForReactivation).toBe(fromDb);
  });

  it("both present → nothing missing", () => {
    expect(missingForReactivation("123 Main St\nMcAllen, TX 78501", "owner@rioroofing.com"))
      .toEqual({ mailingAddress: false, replyTo: false });
  });

  it("null, empty, or blank after JavaScript's .trim() is MISSING — for each field on its own", () => {
    // The column's CHECK (0048) strips EXACTLY the 25 code points `.trim()`
    // strips, through a named character class — not `btrim`, which strips
    // only the ASCII space (0048's header measures why) — so the junk list
    // includes a newline, a tab and a no-break space (written `\u00A0` so the
    // line is reviewable) as well as spaces. Mutation: drop the `.trim()` on
    // the address → the whitespace rows red BY NAME; drop the reply-to
    // judgement → the reply-to half reds.
    for (const blank of [null, undefined, "", "   ", " \n\t\u00A0 "]) {
      expect(missingForReactivation(blank, "owner@rioroofing.com"), JSON.stringify(blank))
        .toEqual({ mailingAddress: true, replyTo: false });
      expect(missingForReactivation("123 Main St", blank), JSON.stringify(blank))
        .toEqual({ mailingAddress: false, replyTo: true });
    }
    expect(missingForReactivation(null, null)).toEqual({ mailingAddress: true, replyTo: true });
  });
});
