import { describe, it, expect } from "vitest";
import { holdingLabel } from "./holding-label";

/**
 * S-47e (E8, spec 5.12.4, S29): the one name a shared number's holding thread shows wherever a
 * customer's name would — never "Caller" (0098's own stored first_name for the record).
 */
describe("holdingLabel", () => {
  it("formats a NANP number through formatPhone, English (mutation: print the raw E.164 -> FAILS)", () => {
    expect(holdingLabel("+19565550142", "en")).toBe("Shared number (956) 555-0142");
  });

  it("formats the same number in Spanish (mutation: hard-code English -> FAILS)", () => {
    expect(holdingLabel("+19565550142", "es")).toBe("Número compartido (956) 555-0142");
  });

  it("a non-NANP number formatPhone cannot reformat renders as-is (mutation: strip the + -> FAILS)", () => {
    expect(holdingLabel("+528999221234", "en")).toBe("Shared number +528999221234");
  });
});
