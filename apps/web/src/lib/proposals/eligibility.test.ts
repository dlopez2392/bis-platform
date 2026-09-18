import { describe, it, expect } from "vitest";
import { callIsEligible } from "./eligibility";
import type { TranscriptEvent } from "@bis/db";

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

const real: TranscriptEvent[] = [
  t("assistant", "Thanks for calling. How can I help?"),
  t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
];

describe("callIsEligible", () => {
  it("accepts an ordinary call that captured a lead", () => {
    expect(callIsEligible({ outcome: "lead", transcript: real, handoffRequested: false })).toBe(true);
  });

  it("refuses a spam call (mutation: mark spam eligible in the outcome map -> FAILS)", () => {
    expect(callIsEligible({ outcome: "spam", transcript: real, handoffRequested: false })).toBe(false);
  });

  it("refuses an abandoned call (mutation: mark abandoned eligible in the outcome map -> FAILS)", () => {
    expect(callIsEligible({ outcome: "abandoned", transcript: real, handoffRequested: false })).toBe(false);
  });

  // THE ONE THAT OUTCOME ALONE CANNOT CATCH. classifyOutcome never returns
  // "transferred" — a handed-off call is stamped `abandoned` at socket
  // close and only becomes `transferred` later, from /handoff-result. So a
  // row reading `abandoned` may be a SUCCESSFUL transfer whose transcript
  // provably stops mid-conversation. Proposing from half a call is
  // proposing from a call we did not hear the end of.
  it("refuses a call that asked for a person, whatever the outcome says (mutation: drop the handoff check -> FAILS)", () => {
    expect(callIsEligible({ outcome: "transferred", transcript: real, handoffRequested: true })).toBe(false);
    expect(callIsEligible({ outcome: "abandoned", transcript: real, handoffRequested: true })).toBe(false);
    expect(callIsEligible({ outcome: "booked", transcript: real, handoffRequested: true })).toBe(false);
  });

  // PROVED against production behaviour: with the old denylist,
  // callIsEligible({ outcome: "transferred", handoffRequested: false, ... })
  // returned true, because a denylist admits anything it has never named. An
  // allow-list must refuse "transferred" on its own, without help from the
  // handoff flag.
  it("refuses a transferred outcome even when handoffRequested is false (mutation: default an unlisted outcome to eligible -> FAILS)", () => {
    expect(callIsEligible({ outcome: "transferred", transcript: real, handoffRequested: false })).toBe(false);
  });

  it("refuses a call with no caller turn at all", () => {
    expect(callIsEligible({
      outcome: "message", transcript: [t("assistant", "Thanks for calling.")], handoffRequested: false,
    })).toBe(false);
  });

  it("refuses a call whose only caller turn is blank (mutation: check role only, ignore text -> FAILS)", () => {
    expect(callIsEligible({
      outcome: "lead",
      transcript: [t("assistant", "Thanks for calling."), t("caller", "   ")],
      handoffRequested: false,
    })).toBe(false);
  });

  it("refuses an empty transcript", () => {
    expect(callIsEligible({ outcome: "message", transcript: [], handoffRequested: false })).toBe(false);
  });

  it("accepts booked and message calls", () => {
    expect(callIsEligible({ outcome: "booked", transcript: real, handoffRequested: false })).toBe(true);
    expect(callIsEligible({ outcome: "message", transcript: real, handoffRequested: false })).toBe(true);
  });
});
