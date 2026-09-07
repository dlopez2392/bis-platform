import { describe, it, expect } from "vitest";
import {
  SETUP_STEP_KEYS, isLockedStep, lockedPrereqKeys, railKindOf,
  nextStepKey, defaultStepKey, parseStepParam,
} from "./setup-rail";
import type { SetupStepView } from "./setup-view";

const view = (
  key: SetupStepView["key"], over: Partial<SetupStepView> = {},
): SetupStepView => ({ key, done: false, skipped: false, unknown: false, ...over });

// Nine views in canonical order, all not-done unless overridden.
function views(over: Partial<Record<SetupStepView["key"], Partial<SetupStepView>>> = {}) {
  return SETUP_STEP_KEYS.map((k) => view(k, over[k] ?? {}));
}

describe("SETUP_STEP_KEYS", () => {
  it("is the canonical nine in wizard order", () => {
    expect(SETUP_STEP_KEYS).toEqual([
      "account", "branding", "hours", "voice_profile", "number",
      "email", "forwarding", "test_call", "go_live",
    ]);
  });
});

describe("isLockedStep", () => {
  it("locks ONLY test_call and go_live, and only when their prerequisites are unmet", () => {
    const unmet = views(); // nothing done
    const met = SETUP_STEP_KEYS.reduce(
      (a, k) => ({ ...a, [k]: { done: true } }),
      {} as Record<SetupStepView["key"], Partial<SetupStepView>>,
    );
    const metViews = views(met);
    expect(isLockedStep("test_call", unmet)).toBe(true);
    expect(isLockedStep("go_live", unmet)).toBe(true);
    expect(isLockedStep("test_call", metViews)).toBe(false);
    expect(isLockedStep("go_live", metViews)).toBe(false);
    for (const k of ["account", "branding", "hours", "voice_profile", "number", "email", "forwarding"] as const) {
      expect(isLockedStep(k, unmet)).toBe(false);
    }
  });
});

describe("lockedPrereqKeys", () => {
  it("names go_live's unmet prerequisites, including an UNKNOWN one", () => {
    // branding done, hours done, voice_profile unknown (read failed), number
    // done, test_call not done
    const v = views({
      branding: { done: true },
      hours: { done: true },
      voice_profile: { done: true, unknown: true },
      number: { done: true },
    });
    expect(lockedPrereqKeys("go_live", v)).toEqual(["voice_profile", "test_call"]);
  });
  it("names branding ALONE when it is the only unmet go-live prerequisite, and locks the step on it", () => {
    // Mutation: drop "branding" from GO_LIVE_PREREQ_KEYS — this list comes
    // back empty, the rail says "not locked", and the pane's Go live button
    // sits disabled (goLivePrereqsMet still refuses) with nothing named
    // under it.
    const v = views({
      hours: { done: true }, voice_profile: { done: true },
      number: { done: true }, test_call: { done: true },
    });
    expect(lockedPrereqKeys("go_live", v)).toEqual(["branding"]);
    expect(isLockedStep("go_live", v)).toBe(true);
  });
  it("names test_call's unmet prerequisites, including an UNKNOWN one", () => {
    // number not done, voice_profile done but unknown (read failed)
    const v = views({
      voice_profile: { done: true, unknown: true },
    });
    expect(lockedPrereqKeys("test_call", v)).toEqual(["voice_profile", "number"]);
  });
  it("is empty for test_call once both prerequisites are done, and unlocks it", () => {
    const v = views({
      number: { done: true },
      voice_profile: { done: true },
    });
    expect(lockedPrereqKeys("test_call", v)).toEqual([]);
    expect(isLockedStep("test_call", v)).toBe(false);
  });
  it("is empty for a step that does not lock", () => {
    expect(lockedPrereqKeys("branding", views())).toEqual([]);
  });
});

describe("railKindOf", () => {
  // The lock is the LAST question this function asks, never the first:
  // `unknown`, `done` and `skipped` all outrank it. That precedence is a
  // phase-wide constraint, which is why the function lives in this module
  // rather than in setup-rail.tsx — vitest.config.ts includes no .tsx, so a
  // decision left there is a decision no test can reach.
  const pick = (vs: SetupStepView[], key: SetupStepView["key"]) =>
    vs.find((v) => v.key === key)!;

  it("keeps an UNKNOWN step unknown, and never calls it locked", () => {
    // The exact collision: test_call's own read failed while both of its
    // prerequisites are also unmet, so the lock is genuinely armed.
    const v = views({ test_call: { unknown: true } });
    expect(isLockedStep("test_call", v)).toBe(true);
    expect(railKindOf(pick(v, "test_call"), false, v)).toBe("unknown");
    // Still unknown when it would otherwise have been the current step.
    expect(railKindOf(pick(v, "test_call"), true, v)).toBe("unknown");
  });

  it("keeps a DONE step done even when its prerequisites have gone unmet again", () => {
    // A real test call was placed; the voice profile has since been cleared.
    // The step is still finished — it does not retroactively need unlocking.
    const v = views({ test_call: { done: true } });
    expect(isLockedStep("test_call", v)).toBe(true);
    expect(railKindOf(pick(v, "test_call"), false, v)).toBe("done");
  });

  it("locks an otherwise-open step whose prerequisites are unmet", () => {
    const v = views(); // nothing done
    expect(railKindOf(pick(v, "test_call"), false, v)).toBe("locked");
    // Including when it would otherwise have been the current step.
    expect(railKindOf(pick(v, "go_live"), true, v)).toBe("locked");
  });

  it("keeps a SKIPPED step skipped", () => {
    const v = views({ email: { skipped: true } });
    expect(railKindOf(pick(v, "email"), false, v)).toBe("skipped");
  });

  it("passes kindOf's answer straight through for a step that cannot lock", () => {
    const v = views({ branding: { done: true } });
    expect(railKindOf(pick(v, "branding"), false, v)).toBe("done");
    expect(railKindOf(pick(v, "hours"), true, v)).toBe("next");
    expect(railKindOf(pick(v, "hours"), false, v)).toBe("open");
  });

  it("unlocks a lockable step once its prerequisites are met", () => {
    const v = views({ number: { done: true }, voice_profile: { done: true } });
    expect(railKindOf(pick(v, "test_call"), true, v)).toBe("next");
    expect(railKindOf(pick(v, "test_call"), false, v)).toBe("open");
  });
});

describe("nextStepKey", () => {
  it("is the first step that is not done", () => {
    expect(nextStepKey(views({ account: { done: true }, branding: { done: true } })))
      .toBe("hours");
  });

  it("steps over a SKIPPED step — the operator already answered it", () => {
    const v = views({
      account: { done: true }, branding: { done: true }, hours: { done: true },
      voice_profile: { done: true }, number: { done: true },
      email: { skipped: true },
    });
    expect(nextStepKey(v)).toBe("forwarding");
  });

  it("steps over an UNKNOWN step — 'reload' is not a task to point at", () => {
    const v = views({
      account: { done: true }, branding: { done: true },
      hours: { unknown: true },
    });
    expect(nextStepKey(v)).toBe("voice_profile");
  });

  it("is null when every step is done, skipped or unknown", () => {
    const all = SETUP_STEP_KEYS.reduce(
      (a, k) => ({ ...a, [k]: { done: true } }),
      {} as Record<SetupStepView["key"], Partial<SetupStepView>>,
    );
    expect(nextStepKey(views({ ...all, email: { skipped: true } }))).toBeNull();
  });
});

describe("defaultStepKey", () => {
  it("is the first not-done step", () => {
    expect(defaultStepKey(views({ account: { done: true }, branding: { done: true } })))
      .toBe("hours");
  });

  /**
   * THE DIVERGENCE THIS PAIR EXISTS TO PREVENT. `defaultStepKey` used to be
   * `find(v => !v.done)` while the "Current" ring came from a separate
   * expression that also excluded skipped and unknown steps. After skipping
   * the email step, opening /setup with no `?step=` therefore landed on
   * "Email identity — Skipped" while the rail rang Call forwarding as
   * Current. One predicate now, asserted as agreeing rather than assumed to.
   */
  it("agrees with nextStepKey over a skipped step", () => {
    const v = views({
      account: { done: true }, branding: { done: true }, hours: { done: true },
      voice_profile: { done: true }, number: { done: true },
      email: { skipped: true },
    });
    expect(defaultStepKey(v)).toBe("forwarding");
    expect(defaultStepKey(v)).toBe(nextStepKey(v));
  });

  it("agrees with nextStepKey over an unknown step", () => {
    const v = views({
      account: { done: true }, branding: { done: true }, hours: { unknown: true },
    });
    expect(defaultStepKey(v)).toBe("voice_profile");
    expect(defaultStepKey(v)).toBe(nextStepKey(v));
  });

  /** Nothing outstanding, but one step is not `done` either — the loose
   *  fallback offers it rather than jumping to go-live over an unresolved
   *  read. */
  it("falls back to a not-done step when nextStepKey has nothing to offer", () => {
    const all = SETUP_STEP_KEYS.reduce(
      (a, k) => ({ ...a, [k]: { done: true } }),
      {} as Record<SetupStepView["key"], Partial<SetupStepView>>,
    );
    const v = views({ ...all, forwarding: { unknown: true } });
    expect(nextStepKey(v)).toBeNull();
    expect(defaultStepKey(v)).toBe("forwarding");
  });

  it("falls back to the last step when everything is done", () => {
    const all = SETUP_STEP_KEYS.reduce((a, k) => ({ ...a, [k]: { done: true } }), {});
    expect(defaultStepKey(views(all))).toBe("go_live");
  });
});

describe("parseStepParam", () => {
  const v = views({ account: { done: true } });
  it("accepts a valid key", () => expect(parseStepParam("number", v)).toBe("number"));
  it("falls back for missing, unknown and malformed values", () => {
    expect(parseStepParam(null, v)).toBe("branding");
    expect(parseStepParam(undefined, v)).toBe("branding");
    expect(parseStepParam("not_a_step", v)).toBe("branding");
    expect(parseStepParam("", v)).toBe("branding");
  });
});
