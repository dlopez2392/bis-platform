import { describe, it, expect } from "vitest";
import { aiAuthorMark } from "./provenance";

describe("aiAuthorMark: DESIGN.md's author mark for the receptionist", () => {
  it("names the account's own persona (mutation: hardcode Sofía → FAILS)", () => {
    expect(aiAuthorMark("Marisol")).toBe("Marisol · AI");
  });

  it("falls back to Sofía when a screen has no persona to hand, or a blank one (mutation: drop the fallback → \" · AI\", FAILS)", () => {
    expect(aiAuthorMark()).toBe("Sofía · AI");
    expect(aiAuthorMark(null)).toBe("Sofía · AI");
    expect(aiAuthorMark("   ")).toBe("Sofía · AI");
  });

  it("a persona carrying `$&` is written literally", () => {
    expect(aiAuthorMark("A$&B")).toBe("A$&B · AI");
  });
});
