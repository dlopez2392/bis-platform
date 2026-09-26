import { describe, it, expect } from "vitest";
import { toE164, isCallerIdNumber } from "./phone-number";

describe("toE164", () => {
  it.each([
    ["9562921696", "+19562921696"],
    ["(956) 292-1696", "+19562921696"],
    ["19562921696", "+19562921696"],
    ["+19562921696", "+19562921696"],
    ["525512345678", "+525512345678"],
  ])("%s → %s", (raw, want) => expect(toE164(raw)).toBe(want));
  it.each([["", null], ["12345", null], [null, null], [undefined, null],
    ["12345678901234567890", null]])("invalid %s → null", (raw, want) =>
    expect(toE164(raw)).toBe(want));
});

// The one rule for "this stored phone is the number the call came from".
// Contacts keep a phone in whatever shape it was typed, so it is normalized
// before the compare; a call with no caller ID matches nothing at all.
describe("isCallerIdNumber", () => {
  it.each([
    ["+19562921696", true],
    ["(956) 292-1696", true],
    ["956-292-1696", true],
    ["+19565550100", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("stored %s against caller ID +19562921696 → %s", (stored, want) =>
    expect(isCallerIdNumber(stored, "+19562921696")).toBe(want));

  it("a withheld caller ID matches nothing — not even a blank stored phone", () => {
    expect(isCallerIdNumber(null, null)).toBe(false);
    expect(isCallerIdNumber("", null)).toBe(false);
    expect(isCallerIdNumber("+19562921696", null)).toBe(false);
  });
});
