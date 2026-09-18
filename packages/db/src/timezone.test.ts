// The write-time gate for `accounts.timezone`.
//
// WHY THIS EXISTS AT THE WRITE POINT AND NOT THE READ POINTS. `timezone` is a
// free-text column with no DB-level IANA validation — Postgres cannot check a
// zone name — so five screens each grew their own downstream patch for an
// unusable value, and they do not agree with each other. Four of them clamp
// silently to UTC (`safeZone(account.timezone, "UTC")`), which renders a
// Texas evening as the following day and says nothing about it: the
// previous-day defect this repo has already shipped once. The work queue
// refuses to guess and omits the date instead. The account dashboard does
// BOTH, fifty lines apart.
//
// None of those is the fix. The fix is that the bad value never gets in, and
// the door is narrower than it looks: `createAccount` is the ONLY write path
// for this column in the whole product — there is no settings action that
// changes an account's zone at all.
import { describe, it, expect } from "vitest";
import { assertUsableZone, isUsableZone } from "./timezone";

describe("isUsableZone", () => {
  it("accepts the zones this platform actually uses", () => {
    for (const z of ["America/Chicago", "America/New_York", "America/Los_Angeles", "UTC"]) {
      expect(isUsableZone(z), z).toBe(true);
    }
  });

  it("accepts a legacy abbreviation, because Intl does — and that is a DST hazard", () => {
    // MEASURED, NOT ASSUMED. This test first asserted "CST" was refused and
    // failed: Node accepts legacy abbreviations as zone identifiers, so a date
    // CAN be formatted in them. This function answers "can Intl use it", and
    // the honest answer here is yes.
    //
    // ⚠️ But CST is a FIXED OFFSET with no daylight saving, so a Chicago
    // business set to "CST" reads an hour wrong from March to November — the
    // same silent-wrongness this whole file exists to stop, arriving through a
    // value that is technically valid. Refusing non-region zones is a separate
    // product decision and is NOT bundled here; inventing a second policy on
    // top of Intl is how the five inconsistent readers happened.
    expect(isUsableZone("CST")).toBe(true);
  });

  it("refuses the typo, which is the whole reason this file exists", () => {
    // A human typing a zone into a form is the realistic source. Every one of
    // these reaches `Intl.DateTimeFormat` as a RangeError.
    for (const z of ["America/Chicgao", "Not/AZone", "America/", "  "]) {
      expect(isUsableZone(z), z).toBe(false);
    }
  });

  it("refuses absent and empty rather than treating them as a default", () => {
    // The DEFAULT belongs to the caller, not here. Conflating "nothing was
    // supplied" with "this is fine" is how a blank form field became
    // America/Chicago for an account in Arizona.
    expect(isUsableZone(undefined)).toBe(false);
    expect(isUsableZone("")).toBe(false);
  });

  it("refuses an absurdly long value without handing it to Intl", () => {
    // Bounded before the probe: the value arrives from a form, and a 10KB
    // string is not a zone whatever Intl would do with it.
    expect(isUsableZone("A/".repeat(500))).toBe(false);
  });
});

describe("assertUsableZone", () => {
  it("returns the zone unchanged when it is usable", () => {
    expect(assertUsableZone("America/Chicago")).toBe("America/Chicago");
  });

  it("THROWS on an unusable zone, naming the value so the operator can see the typo", () => {
    // Throwing, not falling back. A fallback here would be the fifth
    // inconsistent patch for the same problem, and it would be the one that
    // makes the other four unreachable-but-still-wrong.
    expect(() => assertUsableZone("America/Chicgao")).toThrow(/America\/Chicgao/);
  });

  it("the message says what to do, not just what went wrong", () => {
    // This string reaches an operator mid-onboarding, in a form error. "Invalid
    // timezone" tells them nothing; the IANA shape plus an example tells them
    // exactly what to type.
    let message = "";
    try { assertUsableZone("America/Chicgao"); } catch (e) { message = String(e); }
    expect(message).toMatch(/America\/Chicago/);
  });

  it("does not accept its own error path as a zone", () => {
    // Guards the shape of the function rather than its copy: a version that
    // caught its own throw and returned a fallback would pass every test
    // above except this one.
    expect(() => assertUsableZone(undefined)).toThrow();
    expect(() => assertUsableZone("")).toThrow();
  });
});
