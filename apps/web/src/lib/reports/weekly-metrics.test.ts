import { describe, expect, it } from "vitest";
import { countFromOutcomes, ANSWERED_OUTCOMES, LEAD_OUTCOME } from "./weekly-metrics";

/**
 * These two constants ARE the definitions the client's email reports, so they
 * are pinned rather than left to be read off an implementation. `CallOutcome`
 * is `booked | lead | message | abandoned | spam`.
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
