import { describe, it, expect } from "vitest";
import {
  SETUP_STEP_KEYS, isLockedStep, lockedPrereqKeys, railKindOf, defaultStepKey, parseStepParam,
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
    // hours done, voice_profile unknown (read failed), number done, test_call not done
    const v = views({
      hours: { done: true },
      voice_profile: { done: true, unknown: true },
      number: { done: true },
    });
    expect(lockedPrereqKeys("go_live", v)).toEqual(["voice_profile", "test_call"]);
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

describe("defaultStepKey", () => {
  it("is the first not-done step", () => {
    expect(defaultStepKey(views({ account: { done: true }, branding: { done: true } })))
      .toBe("hours");
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
