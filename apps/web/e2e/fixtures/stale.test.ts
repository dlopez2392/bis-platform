import { describe, it, expect } from "vitest";
import {
  FIXTURE_ACCOUNT_RE, FIXTURE_BLUEPRINT_RE, FIXTURE_CO_ACCOUNT_RE, FIXTURE_EMAIL_RE,
  FIXTURE_FORM_RE, FIXTURE_PLAN_RE, STALE_AFTER_MS,
  fixtureStamp, isStaleFixture, isStaleFixtureAccount, isStaleFixtureBlueprint,
  isStaleFixtureForm, isStaleFixturePlan, isUuid,
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

describe("isStaleFixtureForm", () => {
  // A real stamp from one of the five Draft forms `forms.spec.ts`'s finally
  // never reached (danlo found these on Test Client One, 2026-09-20).
  const FORM_STAMP = 1789613520660;
  const LATER = FORM_STAMP + STALE_AFTER_MS + 1;

  it("is true for a form stamp older than the window, both name shapes", () => {
    expect(isStaleFixtureForm(`E2E Form ${FORM_STAMP}`, LATER)).toBe(true);
    expect(isStaleFixtureForm(`E2E Spam ${FORM_STAMP}`, LATER)).toBe(true);
  });

  // The concurrency guard again: a run in progress right now owns a form it
  // created seconds ago, and this must never read as stale out from under it.
  it("is false for a form created moments ago", () => {
    expect(isStaleFixtureForm(`E2E Form ${FORM_STAMP}`, FORM_STAMP + 1000)).toBe(false);
  });

  // The seeded account carries real forms too ("Quote request" among them),
  // so a near-miss has to read as a near-miss, not as a match.
  it("refuses anything that is not exactly the fixture shape, however old", () => {
    for (const value of [
      `E2E Formx ${FORM_STAMP}`,                       // near-miss word
      `E2E Form ${String(FORM_STAMP).slice(0, 12)}`,   // 12 digits
      `E2E Form ${FORM_STAMP}0`,                       // 14 digits
      "Quote request",                                 // a real form on the seeded account
      `e2e Form ${FORM_STAMP}`,                         // lowercase "e2e" — a real form could be named close to this
    ]) {
      expect(isStaleFixtureForm(value, LATER), value).toBe(false);
    }
  });
});

describe("FIXTURE_FORM_RE", () => {
  const FORM_STAMP = 1789613520660;

  it("matches only the two names forms.spec.ts mints", () => {
    expect(FIXTURE_FORM_RE.test(`E2E Form ${FORM_STAMP}`)).toBe(true);
    expect(FIXTURE_FORM_RE.test(`E2E Spam ${FORM_STAMP}`)).toBe(true);
    expect(FIXTURE_FORM_RE.test(`E2E Quiz ${FORM_STAMP}`)).toBe(false);
  });

  // Tested against the regex directly, not through isStaleFixtureForm: an
  // epoch stamp with too few digits can never clear fixtureStamp's own
  // "before 2020" floor regardless of the pattern (a 12-digit ms value tops
  // out in 2001), which would let a widened quantifier slip past unnoticed if
  // this only asserted the end-to-end behaviour. Testing `.test()` isolates
  // the regex's own digit count: mutate `{13}` to `\d+` and both of these
  // flip from false to true.
  it("requires exactly 13 digits, no fewer and no more", () => {
    expect(FIXTURE_FORM_RE.test(`E2E Form ${String(FORM_STAMP).slice(0, 12)}`)).toBe(false);
    expect(FIXTURE_FORM_RE.test(`E2E Form ${FORM_STAMP}0`)).toBe(false);
  });
});

describe("isStaleFixtureAccount", () => {
  // The per-run fixture and the company blueprints.spec.ts creates through
  // the real "Add company" dialog — the second is the shape the sweep could
  // not see before, stranding a real Clerk org + account on every killed run.
  it("is true for both account shapes a spec mints, once older than the window", () => {
    expect(isStaleFixtureAccount(`E2E Client Co ${STAMP}`, LATER)).toBe(true);
    expect(isStaleFixtureAccount(`E2E Co ${STAMP}`, LATER)).toBe(true);
  });

  it("is false for either shape created moments ago", () => {
    expect(isStaleFixtureAccount(`E2E Client Co ${STAMP}`, STAMP + 1000)).toBe(false);
    expect(isStaleFixtureAccount(`E2E Co ${STAMP}`, STAMP + 1000)).toBe(false);
  });

  // The window is the caller's to widen or narrow (sweepStaleFixtures passes
  // its own maxAgeMs through), and a pattern list must not drop it.
  it("honours the caller's window", () => {
    expect(isStaleFixtureAccount(`E2E Co ${STAMP}`, STAMP + 5000, 10_000)).toBe(false);
    expect(isStaleFixtureAccount(`E2E Co ${STAMP}`, STAMP + 10_000, 10_000)).toBe(true);
  });

  // Every near-miss of BOTH shapes, however old the clock: a real company
  // with a name close to either must never read as a fixture.
  it("refuses anything that is not exactly one of the two shapes, however old", () => {
    for (const value of [
      "Test Client One",
      `E2E Client Co-op ${STAMP}`,
      `E2E Co-op ${STAMP}`,                 // a real company that starts the same way
      `E2E Corp ${STAMP}`,
      `E2E Company ${STAMP}`,
      `E2E Co. ${STAMP}`,
      `E2E  Co ${STAMP}`,                   // two spaces
      `E2E Co ${STAMP} LLC`,                // not anchored at the end
      `Acme E2E Co ${STAMP}`,               // not anchored at the start
      ` E2E Co ${STAMP}`,
      `e2e Co ${STAMP}`,                    // lowercase
      `E2E Co ${String(STAMP).slice(0, 12)}`,
      `E2E Co ${STAMP}0`,
      "E2E Co 0000000000000",               // 13 digits, not a plausible time
      `E2E Blueprint ${STAMP}`,             // a blueprint name is not an account name
      `E2E Form ${STAMP}`,
    ]) {
      expect(isStaleFixtureAccount(value, Number.MAX_SAFE_INTEGER), value).toBe(false);
    }
  });

  // A future stamp must never read as ancient — the rule isStaleFixture
  // already pins, re-asserted through the list so a list that bypassed it
  // (an `Math.abs` of its own, say) would red here.
  it("is false for a stamp further in the future than the window", () => {
    expect(isStaleFixtureAccount(`E2E Co ${STAMP}`, STAMP - STALE_AFTER_MS - 1)).toBe(false);
  });
});

describe("FIXTURE_CO_ACCOUNT_RE", () => {
  // Against the regex directly, for the reason FIXTURE_FORM_RE's own digit
  // test gives: a 12-digit stamp can never clear fixtureStamp's 2020 floor,
  // so only `.test()` sees a widened quantifier.
  it("requires exactly 13 digits and nothing else around the words", () => {
    expect(FIXTURE_CO_ACCOUNT_RE.test(`E2E Co ${STAMP}`)).toBe(true);
    expect(FIXTURE_CO_ACCOUNT_RE.test(`E2E Co ${String(STAMP).slice(0, 12)}`)).toBe(false);
    expect(FIXTURE_CO_ACCOUNT_RE.test(`E2E Co ${STAMP}0`)).toBe(false);
    expect(FIXTURE_CO_ACCOUNT_RE.test(`E2E Client Co ${STAMP}`)).toBe(false);
    expect(FIXTURE_ACCOUNT_RE.test(`E2E Co ${STAMP}`)).toBe(false);
  });
});

describe("isStaleFixtureBlueprint", () => {
  it("is true for a blueprint stamp older than the window", () => {
    expect(isStaleFixtureBlueprint(`E2E Blueprint ${STAMP}`, LATER)).toBe(true);
  });

  it("is false for a blueprint captured moments ago", () => {
    expect(isStaleFixtureBlueprint(`E2E Blueprint ${STAMP}`, STAMP + 1000)).toBe(false);
  });

  // Blueprints are agency-wide: a real one ("Roofing starter") sits in the
  // same table as every stranded fixture, so near-misses stay near-misses.
  it("refuses anything that is not exactly the fixture shape, however old", () => {
    for (const value of [
      "Roofing starter",
      `E2E Blueprints ${STAMP}`,
      `E2E Blueprint ${STAMP} v2`,          // the name blueprints.spec.ts types but never saves
      `e2e Blueprint ${STAMP}`,
      `My E2E Blueprint ${STAMP}`,
      `E2E Blueprint ${String(STAMP).slice(0, 12)}`,
      `E2E Blueprint ${STAMP}0`,
      `E2E Co ${STAMP}`,
    ]) {
      expect(isStaleFixtureBlueprint(value, Number.MAX_SAFE_INTEGER), value).toBe(false);
    }
  });

  it("requires exactly 13 digits (against the regex directly)", () => {
    expect(FIXTURE_BLUEPRINT_RE.test(`E2E Blueprint ${String(STAMP).slice(0, 12)}`)).toBe(false);
    expect(FIXTURE_BLUEPRINT_RE.test(`E2E Blueprint ${STAMP}0`)).toBe(false);
  });
});

// MUTATION: widening FIXTURE_PLAN_RE (e.g. dropping the anchors, or the word
// alternation, down to something like /E2E .*(\d{13})/) reds the near-miss
// test below — a real "Growth" plan or a name like "E2E Plans <stamp>" would
// then be admitted, which is exactly the direction that sweeps a live plan.
describe("isStaleFixturePlan", () => {
  it("is true for a plan stamp older than the window, both name shapes", () => {
    expect(isStaleFixturePlan(`E2E Plan ${STAMP}`, LATER)).toBe(true);
    expect(isStaleFixturePlan(`E2E Canary ${STAMP}`, LATER)).toBe(true);
  });

  // The concurrency guard again: a suite running right now owns a plan it
  // created seconds ago.
  it("is false for either shape created moments ago", () => {
    expect(isStaleFixturePlan(`E2E Plan ${STAMP}`, STAMP + 1000)).toBe(false);
    expect(isStaleFixturePlan(`E2E Canary ${STAMP}`, STAMP + 1000)).toBe(false);
  });

  // A real "Growth" plan sits in the same table as every stranded fixture,
  // so a near-miss has to stay a near-miss.
  it("refuses anything that is not exactly one of the two shapes, however old", () => {
    for (const value of [
      "Growth",
      `E2E Plans ${STAMP}`,
      `E2E Plann ${STAMP}`,
      `E2E Canaries ${STAMP}`,
      `e2e Plan ${STAMP}`,
      `My E2E Plan ${STAMP}`,
      `E2E Plan ${STAMP} Draft`,
      `E2E Plan ${String(STAMP).slice(0, 12)}`,
      `E2E Plan ${STAMP}0`,
      `E2E Canary ${String(STAMP).slice(0, 12)}`,
      `E2E Canary ${STAMP}0`,
      `E2E Co ${STAMP}`,
      `E2E Blueprint ${STAMP}`,
    ]) {
      expect(isStaleFixturePlan(value, Number.MAX_SAFE_INTEGER), value).toBe(false);
    }
  });

  it("is false for a stamp further in the future than the window", () => {
    expect(isStaleFixturePlan(`E2E Plan ${STAMP}`, STAMP - STALE_AFTER_MS - 1)).toBe(false);
  });

  it("requires exactly 13 digits (against the regex directly)", () => {
    expect(FIXTURE_PLAN_RE.test(`E2E Plan ${String(STAMP).slice(0, 12)}`)).toBe(false);
    expect(FIXTURE_PLAN_RE.test(`E2E Plan ${STAMP}0`)).toBe(false);
    expect(FIXTURE_PLAN_RE.test(`E2E Canary ${STAMP}`)).toBe(true);
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
