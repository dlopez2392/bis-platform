import { describe, expect, it } from "vitest";
import { countFromOutcomes, ANSWERED_OUTCOMES, LEAD_OUTCOME } from "./weekly-metrics";

/**
 * These two constants ARE the definitions the client's email reports, so they
 * are pinned rather than left to be read off an implementation. `CallOutcome`
 * is `booked | lead | message | abandoned | spam | transferred` (0037 added
 * the sixth, and `ANSWERED_OUTCOMES` counts it — the caller reached a person,
 * so the phone was answered).
 */
describe("what counts as an answered call", () => {
  it("counts booked, lead and message — never spam, never abandoned", () => {
    expect(countFromOutcomes(
      ["booked", "lead", "message", "abandoned", "spam"], ANSWERED_OUTCOMES)).toBe(3);
  });

  it("counts spam as nothing at all, so it cannot flatter the number", () => {
    expect(countFromOutcomes(["spam", "spam", "spam"], ANSWERED_OUTCOMES)).toBe(0);
  });

  it("counts an abandoned call as nothing — nobody handled it", () => {
    expect(countFromOutcomes(["abandoned", "abandoned"], ANSWERED_OUTCOMES)).toBe(0);
  });
});

describe("what counts as a lead from a call", () => {
  it("counts only the lead outcome", () => {
    expect(countFromOutcomes(["booked", "lead", "lead", "message", "spam"], LEAD_OUTCOME)).toBe(2);
  });

  // Both tallies come from ONE read of the same array, so this pins that they
  // are different questions: a booked call was answered but is not a lead.
  it("is a different question from answered — a booking is not a lead", () => {
    const week = ["booked", "booked", "message"];
    expect(countFromOutcomes(week, ANSWERED_OUTCOMES)).toBe(3);
    expect(countFromOutcomes(week, LEAD_OUTCOME)).toBe(0);
  });
});

/**
 * 0037 adds a sixth outcome, and this constant is one of the two places in
 * the product where a call outcome becomes a NUMBER a client reads. Getting
 * it wrong here does not throw — it just under-reports the week.
 */
describe("a transferred call is an answered call", () => {
  it("counts transferred alongside booked, lead and message", () => {
    // The honest reading: the caller reached a person. Whatever else is true
    // of that call, the phone was answered, and a client whose week contained
    // four such calls must not be told it contained none.
    expect(countFromOutcomes(
      ["booked", "lead", "message", "transferred", "abandoned", "spam"], ANSWERED_OUTCOMES)).toBe(4);
    expect(countFromOutcomes(["transferred", "transferred"], ANSWERED_OUTCOMES)).toBe(2);
  });

  it("is still not a lead — reaching a person captures no contact details", () => {
    // Same distinction the booked/lead pair already draws: the two tallies
    // come from ONE read of the same array and answer different questions.
    expect(countFromOutcomes(["transferred", "transferred"], LEAD_OUTCOME)).toBe(0);
  });
});
