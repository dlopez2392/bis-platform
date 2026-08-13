import { describe, it, expect } from "vitest";
import {
  FIXTURE_ACCOUNT_RE, FIXTURE_EMAIL_RE, STALE_AFTER_MS,
  fixtureStamp, isStaleFixture, isUuid,
} from "./stale";

// A real stamp from a real leaked fixture (the account danlo had to delete by
// hand), and a "now" a long way after it.
const STAMP = 1786412389258;
const NAME = `E2E Client Co ${STAMP}`;
const EMAIL = `e2e-client-${STAMP}@example.com`;
const LATER = STAMP + STALE_AFTER_MS + 1;

describe("fixtureStamp", () => {
  it("reads the stamp this suite minted the fixture with", () => {
    expect(fixtureStamp(NAME, FIXTURE_ACCOUNT_RE)).toBe(STAMP);
    expect(fixtureStamp(EMAIL, FIXTURE_EMAIL_RE)).toBe(STAMP);
  });

  it("refuses anything that is not exactly the fixture shape", () => {
    for (const value of [
      "Test Client One",                    // the real seeded account
      "E2E Client Co",                      // no stamp
      `E2E Client Co ${STAMP} `,            // trailing space
      ` E2E Client Co ${STAMP}`,            // leading space
      `E2E Client Co-op ${STAMP}`,          // a real company that starts the same way
      `E2E Client Corporation ${STAMP}`,
      `My E2E Client Co ${STAMP}`,          // not anchored at the start
      `E2E Client Co ${STAMP} Holdings`,    // not anchored at the end
      "E2E Client Co 123",                  // too few digits
      `E2E Client Co ${STAMP}0`,            // too many
    ]) {
      expect(fixtureStamp(value, FIXTURE_ACCOUNT_RE), value).toBeNull();
    }
  });

  it("refuses an email that only resembles the fixture's", () => {
    for (const value of [
      "danlopez508@gmail.com",
      "danlopez508+client@gmail.com",
      `e2e-client-${STAMP}@example.com.evil.test`,
      // A character where the dot belongs. `@examplecom` proved nothing — an
      // unescaped `.` still requires SOMETHING in that position, so the test
      // passed either way; mutation testing is what surfaced that. A real
      // domain in this shape is registrable, which is what makes it the case
      // worth pinning.
      `e2e-client-${STAMP}@examplexcom`,
      `x-e2e-client-${STAMP}@example.com`,
    ]) {
      expect(fixtureStamp(value, FIXTURE_EMAIL_RE), value).toBeNull();
    }
  });

  // 13 digits in the right place is not proof of a timestamp.
  it("refuses a stamp that is not a plausible time", () => {
    expect(fixtureStamp("E2E Client Co 0000000000000", FIXTURE_ACCOUNT_RE)).toBeNull();
    expect(fixtureStamp("E2E Client Co 1111111111111", FIXTURE_ACCOUNT_RE)).toBeNull();
  });
});

describe("isStaleFixture", () => {
  it("is true for a fixture older than the window", () => {
    expect(isStaleFixture(NAME, FIXTURE_ACCOUNT_RE, LATER)).toBe(true);
  });

  // The concurrency guard, and the reason the window exists at all: a suite
  // running RIGHT NOW owns a fixture created seconds ago.
  it("is false for a fixture created moments ago", () => {
    expect(isStaleFixture(NAME, FIXTURE_ACCOUNT_RE, STAMP + 1000)).toBe(false);
  });

  it("is false exactly at the boundary minus one, true at it", () => {
    expect(isStaleFixture(NAME, FIXTURE_ACCOUNT_RE, STAMP + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStaleFixture(NAME, FIXTURE_ACCOUNT_RE, STAMP + STALE_AFTER_MS)).toBe(true);
  });

  // Clock skew must never read as "very old" — that is the direction that
  // deletes a fixture another machine is still using.
  //
  // The skew here EXCEEDS the window on purpose. An earlier version used 60
  // seconds and proved nothing: a signed age of -60s and an absolute age of
  // 60s are both under 30 minutes, so the test passed just as happily against
  // an `Math.abs(now - stamp)` that treats the future as the distant past.
  // Mutation testing is what exposed that; the assertion now fails against it.
  it("is false for a stamp far enough in the future to look ancient in absolute terms", () => {
    expect(isStaleFixture(NAME, FIXTURE_ACCOUNT_RE, STAMP - STALE_AFTER_MS - 1)).toBe(false);
  });

  it("is false for every name that is not a fixture, however old the clock", () => {
    for (const value of ["Test Client One", "E2E Client Co-op 1786412389258", ""]) {
      expect(isStaleFixture(value, FIXTURE_ACCOUNT_RE, Number.MAX_SAFE_INTEGER), value)
        .toBe(false);
    }
  });
});

describe("isUuid", () => {
  it("accepts a real account id and rejects anything else", () => {
    expect(isUuid("d9caa4e7-b8b6-430a-b084-3b0cb7791e65")).toBe(true);
    for (const value of ["", "..", "../../evil", "not-a-uuid", "d9caa4e7b8b6430ab0843b0cb7791e65"]) {
      expect(isUuid(value), value).toBe(false);
    }
  });
});
