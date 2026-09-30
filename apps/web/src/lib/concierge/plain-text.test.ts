import { describe, it, expect } from "vitest";
import { plainText } from "./plain-text";

describe("plainText", () => {
  it("drops paired bold markers, the defect seen live, and keeps the words", () => {
    expect(plainText("1. **BIS Platform**: we build it.\n2. __IT consulting__: we run it."))
      .toBe("1. BIS Platform: we build it.\n2. IT consulting: we run it.");
  });

  it("drops a leading heading marker on any line", () => {
    expect(plainText("## Pricing\nNo prices are published.")).toBe("Pricing\nNo prices are published.");
  });

  it("leaves everything that reads fine as text, or would change meaning if stripped", () => {
    const untouched = "Email ana_garcia@example.com or call 956-555-0100.\n- One\n- Two\n3 * 4 = 12, and *maybe* later. #1 in the Valley.";
    expect(plainText(untouched)).toBe(untouched);
  });

  it("does not join text across lines", () => {
    expect(plainText("**open\nclose**")).toBe("**open\nclose**");
  });
});
