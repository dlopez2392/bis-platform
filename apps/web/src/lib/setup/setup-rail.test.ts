import { describe, it, expect } from "vitest";
import {
  SETUP_STEP_KEYS, isLockedStep, lockedPrereqKeys, railKindOf,
  nextStepKey, defaultStepKey, parseStepParam, stepNumber,
} from "./setup-rail";
import type { SetupStepView } from "./setup-view";
import type { SetupStepKey } from "./setup-status";

const view = (
  key: SetupStepView["key"], over: Partial<SetupStepView> = {},
): SetupStepView => ({ key, done: false, skipped: false, unknown: false, ...over });

// Nine views in canonical order, all not-done unless overridden.
function views(over: Partial<Record<SetupStepView["key"], Partial<SetupStepView>>> = {}) {
  return SETUP_STEP_KEYS.map((k) => view(k, over[k] ?? {}));
}

describe("SETUP_STEP_KEYS", () => {
  it("is the canonical ten in wizard order — website_assistant sits between voice_profile and number", () => {
    expect(SETUP_STEP_KEYS).toEqual([
      "account", "branding", "hours", "voice_profile", "website_assistant", "number",
      "email", "forwarding", "test_call", "go_live",
    ]);
  });
});

describe("isLockedStep", () => {
  it("locks ONLY test_call, go_live and website_assistant, and only when their prerequisites are unmet", () => {
    const unmet = views(); // nothing done
    const met = SETUP_STEP_KEYS.reduce(
      (a, k) => ({ ...a, [k]: { done: true } }),
      {} as Record<SetupStepView["key"], Partial<SetupStepView>>,
    );
    const metViews = views(met);
    expect(isLockedStep("test_call", unmet)).toBe(true);
    expect(isLockedStep("go_live", unmet)).toBe(true);
    expect(isLockedStep("website_assistant", unmet)).toBe(true);
    expect(isLockedStep("test_call", metViews)).toBe(false);
    expect(isLockedStep("go_live", metViews)).toBe(false);
    expect(isLockedStep("website_assistant", metViews)).toBe(false);
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

  // The website assistant answers from the same greeting and facts the phone
  // does — it has exactly one prerequisite, voice_profile, unlike test_call
  // and go_live's several.
  it("names voice_profile as website_assistant's one prerequisite when it is undone", () => {
    expect(lockedPrereqKeys("website_assistant", views())).toEqual(["voice_profile"]);
  });

  it("is empty for website_assistant once voice_profile is done, and unlocks it", () => {
    const v = views({ voice_profile: { done: true } });
    expect(lockedPrereqKeys("website_assistant", v)).toEqual([]);
    expect(isLockedStep("website_assistant", v)).toBe(false);
  });

  // MUTATION: use `!v.done` alone (drop `|| v.unknown`) — this FAILS, because
  // an unverifiable voice_profile read would stop naming itself as a blocker
  // while website_assistant stays practically un-usable (its own `profile`
  // read failed too, per READS_BEHIND).
  it("still names voice_profile when it is done:true but unknown (a failed read)", () => {
    const v = views({ voice_profile: { done: true, unknown: true } });
    expect(lockedPrereqKeys("website_assistant", v)).toEqual(["voice_profile"]);
  });

  // DECIDED (review round): a CRM-only account's own `views` carries NO
  // `voice_profile` entry at all — locking website_assistant against a step
  // this account doesn't have would need a reason that names something the
  // rail never shows. The profile requirement is not dropped; it moves
  // INSIDE this step's own pane instead (row 1,
  // setup/steps/website-assistant.tsx, via the shared `isVoiceProfileDone`
  // predicate) — the one surface a CRM-only account actually sees for this
  // step. Pinned here, against a CRM-only-shaped `views`, so a future change
  // that tries to "fix" this by reaching past `views` for a profile signal
  // has to change this test on purpose.
  it("never locks website_assistant on a CRM-only plan — there is no voice_profile view to name; row 1 inside the pane carries that signal instead", () => {
    const crmOnlyKeys: SetupStepKey[] = ["account", "branding", "hours", "website_assistant", "email"];
    const v = crmOnlyKeys.map((k) => view(k));
    expect(lockedPrereqKeys("website_assistant", v)).toEqual([]);
    expect(isLockedStep("website_assistant", v)).toBe(false);
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
      voice_profile: { done: true }, website_assistant: { done: true },
      number: { done: true }, email: { skipped: true },
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
      voice_profile: { done: true }, website_assistant: { done: true },
      number: { done: true }, email: { skipped: true },
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

// A CRM-only account's own `views` never carries a view for the five
// Sofía-only steps (deriveSetupStatus drops them entirely — see
// setup-status.ts). A stale bookmark, a shared link, or someone hand-editing
// the URL can still send `?step=number` here even though this account has no
// such step at all.
function crmOnlyViews(done: Partial<Record<SetupStepKey, boolean>> = {}): SetupStepView[] {
  const keys: SetupStepKey[] = ["account", "branding", "hours", "website_assistant", "email"];
  return keys.map((k) => view(k, { done: done[k] ?? false }));
}

describe("parseStepParam — a step absent from THIS account's own views (CRM-only plan)", () => {
  it("falls back rather than returning a key with no matching view — the full SETUP_STEP_KEYS list still names it, but this account's views do not", () => {
    const v = crmOnlyViews({ account: true });
    // MUTATION: check `SETUP_STEP_KEYS.includes(raw)` instead of `views.some(...)`
    // — this FAILS, since "number" is one of the full canonical ten even
    // though this account's own `views` has no such entry, and the old
    // behaviour returned it anyway: setup-shell.tsx's `views.find(v => v.key
    // === selected)` would then come back `undefined` and render nothing.
    expect(parseStepParam("number", v)).not.toBe("number");
    expect(parseStepParam("number", v)).toBe(defaultStepKey(v));
  });

  it("still accepts a key that IS present in this account's own views", () => {
    const v = crmOnlyViews();
    expect(parseStepParam("website_assistant", v)).toBe("website_assistant");
  });
});

describe("defaultStepKey — the final fallback when a CRM-only account is fully done", () => {
  it("falls back to the LAST step in THIS account's views, not the full canonical list's go_live", () => {
    const v = crmOnlyViews({ account: true, branding: true, hours: true, website_assistant: true, email: true });
    // MUTATION: fall back to `SETUP_STEP_KEYS[SETUP_STEP_KEYS.length - 1]`
    // ("go_live") — this FAILS: this account has no go_live view at all, so
    // selecting it would render a blank pane (setup-shell.tsx's `if (!view)
    // return null`).
    expect(defaultStepKey(v)).toBe("email");
  });
});

describe("stepNumber", () => {
  it("is contiguous 01..10 for the full plan, unchanged", () => {
    const v = views();
    expect(SETUP_STEP_KEYS.map((k) => stepNumber(k, v))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // MUTATION: index into SETUP_STEP_KEYS instead of this account's own
  // `views` — this FAILS, producing [1, 2, 3, 4, 6] (website_assistant sits
  // at SETUP_STEP_KEYS's index 4, email at index 6) instead of a gapless
  // count.
  it("is contiguous 01..05 for a CRM-only plan's five steps, not the full list's 1,2,3,5,7", () => {
    const keys: SetupStepKey[] = ["account", "branding", "hours", "website_assistant", "email"];
    const v = crmOnlyViews();
    expect(keys.map((k) => stepNumber(k, v))).toEqual([1, 2, 3, 4, 5]);
  });

  it("is contiguous 01..04 when website_assistant is also dropped (web_concierge off too)", () => {
    const keys: SetupStepKey[] = ["account", "branding", "hours", "email"];
    const v = keys.map((k) => view(k));
    expect(keys.map((k) => stepNumber(k, v))).toEqual([1, 2, 3, 4]);
  });
});
