import { describe, it, expect } from "vitest";
import { deriveSetupStatus, type SetupInputs, type SetupStepKey } from "./setup-status";
import {
  buildSetupViews, kindOf, resolveAssignedNumber, requiresMoveConfirm, canEnableTestCalls,
  READS_BEHIND, type ReadKey, type SetupStepView,
} from "./setup-view";

// Same fully-configured fixture setup-status.test.ts uses: every step reads
// done, so any `unknown` seen below is provably the fault-injection, not a
// side effect of an undone step.
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

const noFailures: Record<ReadKey, boolean> = {
  account: false, calendar: false, profile: false,
  numbers: false, ticks: false, calls: false,
};

function unknownKeys(views: SetupStepView[]): SetupStepKey[] {
  return views.filter((v) => v.unknown).map((v) => v.key);
}

describe("buildSetupViews — READS_BEHIND fault mapping", () => {
  it("with no failed reads, no step renders unknown and prereqsMet mirrors goLivePrereqsMet", () => {
    const steps = deriveSetupStatus(fullInputs());
    const { views, prereqsMet } = buildSetupViews(steps, noFailures);
    expect(unknownKeys(views)).toEqual([]);
    expect(prereqsMet).toBe(true);
  });

  it("a failed checklist (ticks) read degrades EXACTLY email and forwarding — hours untouched", () => {
    const steps = deriveSetupStatus(fullInputs());
    const { views } = buildSetupViews(steps, { ...noFailures, ticks: true });
    expect(unknownKeys(views).sort()).toEqual(["email", "forwarding"]);
    expect(views.find((v) => v.key === "hours")?.unknown).toBe(false);
  });

  it("a failed calendar read degrades exactly hours", () => {
    const steps = deriveSetupStatus(fullInputs());
    const { views } = buildSetupViews(steps, { ...noFailures, calendar: true });
    expect(unknownKeys(views)).toEqual(["hours"]);
  });

  it("an unknown prereq step forces prereqsMet false even when every step reads done", () => {
    const steps = deriveSetupStatus(fullInputs());
    // Sanity: without the fault, this fixture's steps really do satisfy
    // goLivePrereqsMet — otherwise a false prereqsMet below proves nothing.
    expect(buildSetupViews(steps, noFailures).prereqsMet).toBe(true);

    // `calendar` backs `hours`, one of GO_LIVE_PREREQ_KEYS — done:true on the
    // step itself, but the read that would confirm it never answered.
    const { views, prereqsMet } = buildSetupViews(steps, { ...noFailures, calendar: true });
    expect(views.find((v) => v.key === "hours")?.done).toBe(true);
    expect(prereqsMet).toBe(false);
  });
});

describe("kindOf", () => {
  it("checks unknown BEFORE done — a step with unknown:true, done:true renders 'unknown', not 'done'", () => {
    const view: SetupStepView = { key: "hours", done: true, skipped: false, unknown: true };
    expect(kindOf(view, false)).toBe("unknown");
  });

  it("falls through to done/skipped/open/next once unknown is false", () => {
    expect(kindOf({ key: "hours", done: true, skipped: false, unknown: false }, false)).toBe("done");
    expect(kindOf({ key: "email", done: false, skipped: true, unknown: false }, false)).toBe("skipped");
    expect(kindOf({ key: "branding", done: false, skipped: false, unknown: false }, false)).toBe("open");
    expect(kindOf({ key: "branding", done: false, skipped: false, unknown: false }, true)).toBe("next");
  });
});

describe("READS_BEHIND", () => {
  it("covers all nine step keys", () => {
    const keys = Object.keys(READS_BEHIND).sort();
    expect(keys).toEqual([
      "account", "branding", "email", "forwarding", "go_live",
      "hours", "number", "test_call", "voice_profile",
    ]);
  });
});

describe("resolveAssignedNumber", () => {
  it("returns 'unknown' when the numbers read failed, regardless of what's in the array", () => {
    expect(
      resolveAssignedNumber([{ id: "n1", status: "live", e164: "+19565550111" }], true),
    ).toBe("unknown");
    expect(resolveAssignedNumber([], true)).toBe("unknown");
  });

  it("returns the first non-released number's id/e164/status when the read succeeded", () => {
    expect(
      resolveAssignedNumber(
        [
          { id: "n0", status: "released", e164: "+19565550100" },
          { id: "n1", status: "live", e164: "+19565550111" },
        ],
        false,
      ),
    ).toEqual({ id: "n1", e164: "+19565550111", status: "live" });
  });

  it("returns null — not 'unknown' — when the read succeeded and no live number exists", () => {
    expect(resolveAssignedNumber([], false)).toBe(null);
    expect(
      resolveAssignedNumber([{ id: "n0", status: "released", e164: "+19565550100" }], false),
    ).toBe(null);
  });
});

describe("canEnableTestCalls", () => {
  it("offers the button only for a provisioned number", () => {
    expect(canEnableTestCalls("provisioned")).toBe(true);
  });

  it("does not offer it for a number already answering calls, or a former number", () => {
    expect(canEnableTestCalls("testing")).toBe(false);
    expect(canEnableTestCalls("live")).toBe(false);
    expect(canEnableTestCalls("released")).toBe(false);
  });
});

describe("requiresMoveConfirm", () => {
  it("requires the destructive confirm for a number answering real calls right now", () => {
    expect(requiresMoveConfirm("testing")).toBe(true);
    expect(requiresMoveConfirm("live")).toBe(true);
  });

  it("allows a one-click move for a number that answers nobody", () => {
    expect(requiresMoveConfirm("provisioned")).toBe(false);
    expect(requiresMoveConfirm("released")).toBe(false);
  });
});
