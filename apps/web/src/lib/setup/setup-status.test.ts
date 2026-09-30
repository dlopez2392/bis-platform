import { describe, it, expect } from "vitest";
import {
  deriveSetupStatus, goLivePrereqsMet, reduceSetupProgress, SETUP_TICK_KEYS,
  type SetupInputs, type SetupStepState, type SetupStepKey,
} from "./setup-status";
import { DEMO_FORWARDING_TICK_KEY } from "@bis/db";

// A fully-configured tenant: every check should read done. Individual tests
// override one field at a time so each assertion isolates a single check —
// the rest of the fixture staying "done" is what proves the override, not
// some other field, is what flipped the result.
function fullInputs(overrides: Partial<SetupInputs> = {}): SetupInputs {
  return {
    brandName: "Acme Dental",
    fromEmail: "hello@acmedental.example",
    calendar: { enabled: true, open_hours: { mon: [["09:00", "17:00"]] } },
    profile: {
      greeting_en: "Thanks for calling Acme Dental.",
      greeting_es: "Gracias por llamar a Acme Dental.",
      facts: "Open Monday through Friday, 9 to 5.",
      enabled: true,
      languages: "en",
      // website_assistant done in the full fixture too, so "every step
      // done" tests reach all ten without a dedicated override.
      concierge_enabled: true,
      concierge_form_id: "form_full",
      public_id: "pub_full",
    },
    numbers: [{ status: "live" }],
    callCount: 3,
    ticks: { emailSkipped: false, forwardingDone: true },
    publishedFormCount: 1,
    conciergeSiteConversation: true,
    ...overrides,
  };
}

// A brand new tenant: nothing configured yet. Used for the account check
// (which never flips) and as a starting point for goLivePrereqsMet negatives.
const emptyInputs: SetupInputs = {
  brandName: null,
  fromEmail: null,
  calendar: null,
  profile: null,
  numbers: [],
  callCount: 0,
  ticks: { emailSkipped: false, forwardingDone: false },
  publishedFormCount: 0,
  conciergeSiteConversation: false,
};

function stepFor(steps: SetupStepState[], key: SetupStepKey): SetupStepState {
  const found = steps.find((s) => s.key === key);
  if (!found) throw new Error(`deriveSetupStatus dropped step "${key}"`);
  return found;
}

describe("deriveSetupStatus shape", () => {
  it("always returns all ten steps, in canonical order — website_assistant sits between voice_profile and number", () => {
    const steps = deriveSetupStatus(fullInputs());
    expect(steps.map((s) => s.key)).toEqual<SetupStepKey[]>([
      "account", "branding", "hours", "voice_profile", "website_assistant", "number",
      "email", "forwarding", "test_call", "go_live",
    ]);
  });

  it("returns all ten steps even for a brand new, wholly unconfigured tenant", () => {
    const steps = deriveSetupStatus(emptyInputs);
    expect(steps).toHaveLength(10);
  });
});

describe("account", () => {
  it("is always done — true for a fully configured tenant and a brand new one alike", () => {
    expect(stepFor(deriveSetupStatus(fullInputs()), "account").done).toBe(true);
    expect(stepFor(deriveSetupStatus(emptyInputs), "account").done).toBe(true);
  });
});

describe("branding", () => {
  it("is done when brandName is non-blank after trim", () => {
    const steps = deriveSetupStatus(fullInputs({ brandName: "  Acme Dental  " }));
    expect(stepFor(steps, "branding").done).toBe(true);
  });

  it("is not done when brandName is null", () => {
    const steps = deriveSetupStatus(fullInputs({ brandName: null }));
    expect(stepFor(steps, "branding").done).toBe(false);
  });

  it("is not done when brandName is whitespace-only", () => {
    const steps = deriveSetupStatus(fullInputs({ brandName: "   " }));
    expect(stepFor(steps, "branding").done).toBe(false);
  });
});

describe("hours", () => {
  it("is done when the calendar is enabled and at least one day has a non-empty window", () => {
    const steps = deriveSetupStatus(fullInputs({
      calendar: { enabled: true, open_hours: { mon: [["09:00", "17:00"]] } },
    }));
    expect(stepFor(steps, "hours").done).toBe(true);
  });

  it("is NOT done for enabled + open_hours: {} — the exact wiped-config state from exit-gate call #1 that made every day read 'no availability'", () => {
    const steps = deriveSetupStatus(fullInputs({
      calendar: { enabled: true, open_hours: {} },
    }));
    expect(stepFor(steps, "hours").done).toBe(false);
  });

  it("is not done when every configured day has an empty window array", () => {
    const steps = deriveSetupStatus(fullInputs({
      calendar: { enabled: true, open_hours: { mon: [], tue: [] } },
    }));
    expect(stepFor(steps, "hours").done).toBe(false);
  });

  it("is not done when the calendar is disabled, even with real hours configured", () => {
    const steps = deriveSetupStatus(fullInputs({
      calendar: { enabled: false, open_hours: { mon: [["09:00", "17:00"]] } },
    }));
    expect(stepFor(steps, "hours").done).toBe(false);
  });

  it("is not done when there is no calendar row at all", () => {
    const steps = deriveSetupStatus(fullInputs({ calendar: null }));
    expect(stepFor(steps, "hours").done).toBe(false);
  });
});

describe("voice_profile", () => {
  it("is done when facts and the primary-language (en) greeting are both non-blank", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi, thanks for calling!", greeting_es: "",
        facts: "We fix things.", enabled: true, languages: "en",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(true);
  });

  it("mirrors the incoming route's language pick: an es profile is done with only greeting_es set", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "", greeting_es: "¡Hola, gracias por llamar!",
        facts: "Reparamos cosas.", enabled: true, languages: "es",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(true);
  });

  it("an es profile is NOT done with only greeting_en set — step 11 reads greeting_es for languages 'es'", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi, thanks for calling!", greeting_es: "",
        facts: "Reparamos cosas.", enabled: true, languages: "es",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(false);
  });

  it("a 'both' profile also takes the else-branch — done via greeting_en", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi, thanks for calling!", greeting_es: "",
        facts: "We fix things.", enabled: true, languages: "both",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(true);
  });

  it("is not done when facts is blank, even with a greeting set", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi, thanks for calling!", greeting_es: "",
        facts: "   ", enabled: true, languages: "en",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(false);
  });

  it("is not done when there is no voice profile at all", () => {
    const steps = deriveSetupStatus(fullInputs({ profile: null }));
    expect(stepFor(steps, "voice_profile").done).toBe(false);
  });
});

describe("number", () => {
  it("is done when a number has status provisioned, testing, or live", () => {
    expect(stepFor(deriveSetupStatus(fullInputs({ numbers: [{ status: "provisioned" }] })), "number").done).toBe(true);
    expect(stepFor(deriveSetupStatus(fullInputs({ numbers: [{ status: "testing" }] })), "number").done).toBe(true);
    expect(stepFor(deriveSetupStatus(fullInputs({ numbers: [{ status: "live" }] })), "number").done).toBe(true);
  });

  it("is NOT done when the only number is released", () => {
    const steps = deriveSetupStatus(fullInputs({ numbers: [{ status: "released" }] }));
    expect(stepFor(steps, "number").done).toBe(false);
  });

  it("is not done with no numbers at all", () => {
    const steps = deriveSetupStatus(fullInputs({ numbers: [] }));
    expect(stepFor(steps, "number").done).toBe(false);
  });
});

describe("email", () => {
  it("is done, and not skipped, when fromEmail is non-blank", () => {
    const email = stepFor(deriveSetupStatus(fullInputs({ fromEmail: "hello@acmedental.example" })), "email");
    expect(email.done).toBe(true);
    expect(email.skipped).toBe(false);
  });

  it("is not done but marked skipped when fromEmail is blank and the user ticked skip", () => {
    const email = stepFor(deriveSetupStatus(fullInputs({
      fromEmail: null, ticks: { emailSkipped: true, forwardingDone: true },
    })), "email");
    expect(email.done).toBe(false);
    expect(email.skipped).toBe(true);
  });

  it("is not done and not skipped when fromEmail is blank and skip was never ticked", () => {
    const email = stepFor(deriveSetupStatus(fullInputs({
      fromEmail: null, ticks: { emailSkipped: false, forwardingDone: true },
    })), "email");
    expect(email.done).toBe(false);
    expect(email.skipped).toBe(false);
  });

  it("is done and not skipped when fromEmail becomes non-blank despite a stale emailSkipped tick", () => {
    const email = stepFor(deriveSetupStatus(fullInputs({
      fromEmail: "hello@acmedental.example", ticks: { emailSkipped: true, forwardingDone: true },
    })), "email");
    expect(email.done).toBe(true);
    expect(email.skipped).toBe(false);
  });
});

describe("forwarding", () => {
  it("is done when ticks.forwardingDone is true", () => {
    const steps = deriveSetupStatus(fullInputs({ ticks: { emailSkipped: false, forwardingDone: true } }));
    expect(stepFor(steps, "forwarding").done).toBe(true);
  });

  it("is not done when ticks.forwardingDone is false", () => {
    const steps = deriveSetupStatus(fullInputs({ ticks: { emailSkipped: false, forwardingDone: false } }));
    expect(stepFor(steps, "forwarding").done).toBe(false);
  });
});

describe("test_call", () => {
  it("is done when callCount is greater than zero", () => {
    const steps = deriveSetupStatus(fullInputs({ callCount: 1 }));
    expect(stepFor(steps, "test_call").done).toBe(true);
  });

  it("is not done when callCount is zero", () => {
    const steps = deriveSetupStatus(fullInputs({ callCount: 0 }));
    expect(stepFor(steps, "test_call").done).toBe(false);
  });
});

describe("go_live", () => {
  it("is done when the voice profile is enabled AND some number is live", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi!", greeting_es: "", facts: "We fix things.",
        enabled: true, languages: "en",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
      numbers: [{ status: "live" }],
    }));
    expect(stepFor(steps, "go_live").done).toBe(true);
  });

  it("is not done when the profile is disabled, even with a live number", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi!", greeting_es: "", facts: "We fix things.",
        enabled: false, languages: "en",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
      numbers: [{ status: "live" }],
    }));
    expect(stepFor(steps, "go_live").done).toBe(false);
  });

  it("is not done when no number is live, even with provisioned/testing numbers present", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi!", greeting_es: "", facts: "We fix things.",
        enabled: true, languages: "en",
        concierge_enabled: false, concierge_form_id: null, public_id: null,
      },
      numbers: [{ status: "provisioned" }, { status: "testing" }],
    }));
    expect(stepFor(steps, "go_live").done).toBe(false);
  });

  it("is not done when there is no voice profile at all", () => {
    const steps = deriveSetupStatus(fullInputs({ profile: null, numbers: [{ status: "live" }] }));
    expect(stepFor(steps, "go_live").done).toBe(false);
  });
});

describe("goLivePrereqsMet", () => {
  it("is true when hours, voice_profile, number, and test_call are all done — email and forwarding are NOT required, and branding is done in the full fixture, so the guarantee survives it", () => {
    const steps = deriveSetupStatus(fullInputs({
      fromEmail: null,
      ticks: { emailSkipped: false, forwardingDone: false },
    }));
    // Sanity check: this fixture really does leave email (and forwarding)
    // undone, so a pass here proves they aren't silently required.
    expect(stepFor(steps, "email").done).toBe(false);
    expect(stepFor(steps, "forwarding").done).toBe(false);
    expect(stepFor(steps, "branding").done).toBe(true);
    expect(goLivePrereqsMet(steps)).toBe(true);
  });

  it("is false when hours is not done", () => {
    const steps = deriveSetupStatus(fullInputs({ calendar: { enabled: true, open_hours: {} } }));
    expect(goLivePrereqsMet(steps)).toBe(false);
  });

  it("is false when voice_profile is not done", () => {
    const steps = deriveSetupStatus(fullInputs({ profile: null }));
    expect(goLivePrereqsMet(steps)).toBe(false);
  });

  it("is false when number is not done", () => {
    const steps = deriveSetupStatus(fullInputs({ numbers: [{ status: "released" }] }));
    expect(goLivePrereqsMet(steps)).toBe(false);
  });

  it("is false when test_call is not done", () => {
    const steps = deriveSetupStatus(fullInputs({ callCount: 0 }));
    expect(goLivePrereqsMet(steps)).toBe(false);
  });

  it("is false for a wholly unconfigured tenant", () => {
    const steps = deriveSetupStatus(emptyInputs);
    expect(goLivePrereqsMet(steps)).toBe(false);
  });

  it("is false when branding is not done, even though hours, voice_profile, number, and test_call all are", () => {
    // Mutation: drop isDone("branding") from the goLivePrereqsMet predicate.
    const steps = deriveSetupStatus(fullInputs({ brandName: null }));
    expect(stepFor(steps, "branding").done).toBe(false);
    expect(stepFor(steps, "hours").done).toBe(true);
    expect(stepFor(steps, "voice_profile").done).toBe(true);
    expect(stepFor(steps, "number").done).toBe(true);
    expect(stepFor(steps, "test_call").done).toBe(true);
    expect(goLivePrereqsMet(steps)).toBe(false);
  });
});

describe("reduceSetupProgress", () => {
  it("counts done steps against the full ten for a wholly unconfigured tenant", () => {
    const steps = deriveSetupStatus(emptyInputs);
    expect(reduceSetupProgress(steps)).toEqual({ done: 1, total: 10 }); // account is always done
  });

  it("counts all ten as done for a fully configured, live tenant", () => {
    // fullInputs()'s own defaults are already a fully-done tenant (profile
    // enabled, a live number, concierge on with a form) — no overrides
    // needed to reach 10 of 10.
    const steps = deriveSetupStatus(fullInputs());
    expect(reduceSetupProgress(steps)).toEqual({ done: 10, total: 10 });
  });

  it("does not count a skipped-but-not-done step as done", () => {
    const steps = deriveSetupStatus(fullInputs({
      fromEmail: null, ticks: { emailSkipped: true, forwardingDone: true },
    }));
    const email = stepFor(steps, "email");
    expect(email.done).toBe(false);
    expect(email.skipped).toBe(true);
    expect(reduceSetupProgress(steps).done).toBe(9); // every step but email
  });

  it("total always reflects the number of steps passed in, not a hardcoded 9", () => {
    expect(reduceSetupProgress([{ key: "account", done: true, skipped: false }])).toEqual({ done: 1, total: 1 });
  });
});

describe("website_assistant", () => {
  it("is done when concierge_enabled is true AND a concierge_form_id is set", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        ...fullInputs().profile!,
        concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_1",
      },
    }));
    expect(stepFor(steps, "website_assistant").done).toBe(true);
  });

  // MUTATION: change `done` to `profile?.concierge_enabled === true` alone
  // (drop the `&& Boolean(profile.concierge_form_id)` half) — this FAILS,
  // because concierge_enabled can be true while the form was cleared.
  it("is NOT done when concierge_enabled is true but concierge_form_id is null", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        ...fullInputs().profile!,
        concierge_enabled: true, concierge_form_id: null, public_id: "pub_1",
      },
    }));
    expect(stepFor(steps, "website_assistant").done).toBe(false);
  });

  it("is not done when concierge_form_id is set but concierge_enabled is false", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        ...fullInputs().profile!,
        concierge_enabled: false, concierge_form_id: "form_1", public_id: "pub_1",
      },
    }));
    expect(stepFor(steps, "website_assistant").done).toBe(false);
  });

  it("is not done when there is no voice profile at all", () => {
    const steps = deriveSetupStatus(fullInputs({ profile: null }));
    expect(stepFor(steps, "website_assistant").done).toBe(false);
  });
});

describe("SETUP_TICK_KEYS", () => {
  it("has the exact persisted key strings Tasks 13/14 write to and read from storage", () => {
    expect(SETUP_TICK_KEYS.emailSkipped).toBe("setup:email_skipped");
    expect(SETUP_TICK_KEYS.forwardingDone).toBe("setup:forwarding_done");
  });
});

/**
 * The one string the demo seeder has to know about this file.
 *
 * Nine of the ten setup steps are computed from live rows, so the seeder
 * gets them for free by writing those rows. "forwarding" cannot be computed
 * — no row proves a carrier-side change — so it is a stored tick, and
 * packages/db's `DEMO_FORWARDING_TICK_KEY` carries a second copy of the key
 * because the dependency only runs one way (apps/web imports @bis/db, never
 * the reverse).
 *
 * Two hand-maintained copies of a string is exactly how this repo's
 * neutral-ramps and theme-style mirrors drifted, so the duplication is held
 * by an assertion rather than by a comment asking people to be careful. If
 * the key here is ever renamed, the demo silently stops ticking the step and
 * every screenshot goes back to reading "Setup 8/9" (now "Setup 8/10", the
 * demo seeder does not turn website_assistant on either) — this fails first.
 */
describe("the forwarding tick key is mirrored in @bis/db", () => {
  it("matches the demo seeder's copy exactly", () => {
    expect(DEMO_FORWARDING_TICK_KEY).toBe(SETUP_TICK_KEYS.forwardingDone);
  });
});
