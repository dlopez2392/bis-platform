import { describe, it, expect } from "vitest";
import { e164Of, isCallerIdNumber, spokenPhone } from "./phone-number";

describe("e164Of — normalisePhone's E.164 (F-009)", () => {
  it.each([
    ["9562921696", "+19562921696"],
    ["(956) 292-1696", "+19562921696"],
    ["19562921696", "+19562921696"],
    ["+19562921696", "+19562921696"],
    ["525512345678", "+525512345678"],
    // THE F-009 case: ten digits valid only in Mexico are +52, never +1
    // (mutation: e164Of = old toE164, any ten digits → +1 → FAILS).
    ["(899) 922-1234", "+528999221234"],
  ])("%s → %s", (raw, want) => expect(e164Of(raw)).toBe(want));
  it.each([["", null], ["12345", null], [null, null], [undefined, null],
    ["12345678901234567890", null]])("invalid %s → null", (raw, want) =>
    expect(e164Of(raw)).toBe(want));
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

/**
 * Review R2-C1 / R1-I4: what Sofía's contact writes store. The contact write
 * judges the number (phoneFields); this only decides WHICH text it judges.
 */
describe("spokenPhone — the number a voice contact write stores", () => {
  it("a number said as ten digits is stored as said, never pre-read as +1 (mutation: return e164Of(said) → a confirmed +1, FAILS)", () => {
    expect(spokenPhone("55 1234 5678", "+19565550100")).toBe("55 1234 5678");
    expect(spokenPhone("899-922-1234", null)).toBe("899-922-1234");
  });

  it("a leading 1 or +1 the model added is dropped, so the ten digits are judged (mutation: keep the +1 → FAILS)", () => {
    expect(spokenPhone("+1 551 234 5678", "+19565550100")).toBe("5512345678");
    expect(spokenPhone("15512345678", null)).toBe("5512345678");
    expect(spokenPhone("+52 55 1234 5678", null)).toBe("+52 55 1234 5678");
  });

  it("the caller ID repeated, or nothing usable said, is the caller ID as the carrier gave it (mutation: strip the caller ID's +1 too → it reads as ambiguous, FAILS)", () => {
    expect(spokenPhone("956 555 0100", "+19565550100")).toBe("+19565550100");
    expect(spokenPhone("+1 (956) 555-0100", "+19565550100")).toBe("+19565550100");
    expect(spokenPhone("", "+19565550100")).toBe("+19565550100");
    expect(spokenPhone("five five five", "+19565550100")).toBe("+19565550100");
    expect(spokenPhone("", null)).toBeNull();
  });

  it("a Mexican caller reciting their own ten digits is the caller ID, never a second +1-flagged contact (re-review minor 4; mutation: compare only a +1 caller ID → \"55 1234 5678\", FAILS)", () => {
    expect(spokenPhone("55 1234 5678", "+525512345678")).toBe("+525512345678");
    expect(spokenPhone("899 922 1234", "+5218999221234")).toBe("+5218999221234");
    expect(spokenPhone("55 1234 5679", "+525512345678")).toBe("55 1234 5679");
  });
});
