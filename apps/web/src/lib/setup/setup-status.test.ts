import { describe, it, expect } from "vitest";
import {
  deriveSetupStatus, goLivePrereqsMet, SETUP_TICK_KEYS,
  type SetupInputs, type SetupStepState, type SetupStepKey,
} from "./setup-status";

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
    },
    numbers: [{ status: "live" }],
    callCount: 3,
    ticks: { emailSkipped: false, forwardingDone: true },
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
};

function stepFor(steps: SetupStepState[], key: SetupStepKey): SetupStepState {
  const found = steps.find((s) => s.key === key);
  if (!found) throw new Error(`deriveSetupStatus dropped step "${key}"`);
  return found;
}

describe("deriveSetupStatus shape", () => {
  it("always returns all nine steps, in canonical order", () => {
    const steps = deriveSetupStatus(fullInputs());
    expect(steps.map((s) => s.key)).toEqual<SetupStepKey[]>([
      "account", "branding", "hours", "voice_profile", "number",
      "email", "forwarding", "test_call", "go_live",
    ]);
  });

  it("returns all nine steps even for a brand new, wholly unconfigured tenant", () => {
    const steps = deriveSetupStatus(emptyInputs);
    expect(steps).toHaveLength(9);
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
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(true);
  });

  it("mirrors the incoming route's language pick: an es profile is done with only greeting_es set", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "", greeting_es: "¡Hola, gracias por llamar!",
        facts: "Reparamos cosas.", enabled: true, languages: "es",
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(true);
  });

  it("an es profile is NOT done with only greeting_en set — step 11 reads greeting_es for languages 'es'", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi, thanks for calling!", greeting_es: "",
        facts: "Reparamos cosas.", enabled: true, languages: "es",
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(false);
  });

  it("a 'both' profile also takes the else-branch — done via greeting_en", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi, thanks for calling!", greeting_es: "",
        facts: "We fix things.", enabled: true, languages: "both",
      },
    }));
    expect(stepFor(steps, "voice_profile").done).toBe(true);
  });

  it("is not done when facts is blank, even with a greeting set", () => {
    const steps = deriveSetupStatus(fullInputs({
      profile: {
        greeting_en: "Hi, thanks for calling!", greeting_es: "",
        facts: "   ", enabled: true, languages: "en",
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
  it("is true when hours, voice_profile, number, and test_call are all done — email and forwarding are NOT required", () => {
    const steps = deriveSetupStatus(fullInputs({
      fromEmail: null,
      ticks: { emailSkipped: false, forwardingDone: false },
    }));
    // Sanity check: this fixture really does leave email (and forwarding)
    // undone, so a pass here proves they aren't silently required.
    expect(stepFor(steps, "email").done).toBe(false);
    expect(stepFor(steps, "forwarding").done).toBe(false);
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
});

describe("SETUP_TICK_KEYS", () => {
  it("has the exact persisted key strings Tasks 13/14 write to and read from storage", () => {
    expect(SETUP_TICK_KEYS.emailSkipped).toBe("setup:email_skipped");
    expect(SETUP_TICK_KEYS.forwardingDone).toBe("setup:forwarding_done");
  });
});
