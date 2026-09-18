// The zone a screen should actually render in, and whether it had to guess.
//
// This is the LOGIC half of the fix for a five-screen disagreement. Four
// screens clamp an unusable `accounts.timezone` silently to UTC — printing a
// Texas evening as the following day, the previous-day defect this repo has
// already shipped once. The work queue refuses to guess and omits the date.
// The account dashboard does both, fifty lines apart.
//
// danlo, 2026-09-17: "I do not want to omit the dates so let's find a
// workaround." So nothing omits. The defect was never that UTC appeared — it
// was that UTC appeared SILENTLY, and the reader took it for local time. This
// returns the zone AND whether it is a guess, so the screen can say so.
import { describe, it, expect } from "vitest";
import { resolveZone } from "./zone-resolution";

describe("resolveZone", () => {
  it("uses the account's own zone and reports no guess", () => {
    const r = resolveZone("America/Chicago", "America/New_York");
    expect(r).toMatchObject({ zone: "America/Chicago", guessed: false });
  });

  it("falls back to the AGENCY's zone, not UTC, and says it guessed", () => {
    // The agency creates every account and its clients are local to it, so
    // this guess is right far more often than UTC — and when it is wrong it is
    // wrong by an hour rather than by six. UTC's only virtue was looking
    // obviously foreign, and the `guessed` flag does that job better.
    const r = resolveZone("America/Chicgao", "America/Chicago");
    expect(r).toMatchObject({ zone: "America/Chicago", guessed: true });
  });

  it("falls through to UTC only when the agency's zone is broken too", () => {
    // `agencies.timezone` is the same free-text column shape, so it can be
    // just as broken. A chain that trusted it blindly would move the bug up a
    // level rather than fix it.
    const r = resolveZone("Not/AZone", "Also/Not/AZone");
    expect(r).toMatchObject({ zone: "UTC", guessed: true });
  });

  it("guesses when the account has no zone at all", () => {
    expect(resolveZone(undefined, "America/Chicago")).toMatchObject({
      zone: "America/Chicago", guessed: true,
    });
    expect(resolveZone("", "America/Chicago")).toMatchObject({ guessed: true });
  });

  it("never reports a guess when it did not guess, even falling back to UTC legitimately", () => {
    // An account genuinely SET to UTC is not a guess, and must not be labelled
    // as one. Keying `guessed` off "did we end up at UTC" instead of "did we
    // use the account's own value" would slander every correctly-configured
    // UTC account on the platform.
    const r = resolveZone("UTC", "America/Chicago");
    expect(r).toMatchObject({ zone: "UTC", guessed: false });
  });

  it("carries a short label for the screen to print next to a date", () => {
    // A WORD, not a colour: DESIGN.md rule 3 — status is never colour alone.
    // The label is what turns a silent wrong answer into a visible one, so it
    // is part of the return value rather than left to each of five screens to
    // invent separately.
    expect(resolveZone("America/Chicago", "UTC").label).toBe("America/Chicago");
    expect(resolveZone("Not/AZone", "America/Chicago").label).toBe("America/Chicago");
  });

  it("says WHOSE zone it fell back to, so the operator knows where to fix it", () => {
    // "we guessed" is not actionable; "we used the agency's zone" tells them
    // the account's own setting is the broken one.
    expect(resolveZone("Not/AZone", "America/Chicago").source).toBe("agency");
    expect(resolveZone("Not/AZone", "Not/AZone").source).toBe("fallback");
    expect(resolveZone("America/Chicago", "UTC").source).toBe("account");
  });

  it("is total — no input combination throws", () => {
    // It runs inside a page render. A RangeError here would blank a dashboard,
    // which is a worse outcome than any wrong date.
    const nasty = [undefined, "", "   ", "CST", "A/".repeat(500), "Not/AZone", "UTC"];
    for (const a of nasty) {
      for (const b of nasty) {
        expect(() => resolveZone(a, b)).not.toThrow();
        expect(typeof resolveZone(a, b).zone).toBe("string");
      }
    }
  });
});
