import { describe, it, expect } from "vitest";
import { deadEndTextStyle, deadEndButtonStyle } from "./dead-end-style";

describe("deadEndTextStyle", () => {
  it("uses the dark literal fallback only when ?theme=dark", () => {
    // MUTATION: always use the light literal -- this FAILS, the exact
    // defect (dark text invisible on a transparent, dark host) fix 5
    // exists to clear.
    expect(deadEndTextStyle("dark").color).toBe("var(--foreground, #f4f4f5)");
    expect(deadEndTextStyle("light").color).toBe("var(--foreground, #18181b)");
    expect(deadEndTextStyle(null).color).toBe("var(--foreground, #18181b)");
  });

  it("every colour is a var() reference, never a bare literal", () => {
    for (const value of Object.values(deadEndTextStyle("dark"))) {
      if (typeof value !== "string") continue;
      if (/^#[0-9a-f]{3,8}$/i.test(value)) {
        throw new Error(`bare literal, not a var() reference: ${value}`);
      }
    }
  });
});

describe("deadEndButtonStyle", () => {
  it("routes fill and label through the form-accent token pair", () => {
    const s = deadEndButtonStyle();
    expect(s.background).toBe("var(--form-accent, #6d28d9)");
    expect(s.color).toBe("var(--form-accent-foreground, #ffffff)");
  });
});
