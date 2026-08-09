import { describe, it, expect } from "vitest";
import {
  parseHexColor, contrastRatio, readableTextOn, lightenForSidebar,
  resolveFormAccent, resolveSidebarAccent, FORM_ACCENT_FALLBACK, SIDEBAR_BG,
  ensureContrast,
} from "./color";

describe("parseHexColor", () => {
  it("accepts #rrggbb and normalizes to lowercase", () => {
    expect(parseHexColor("#0F766E")).toBe("#0f766e");
    expect(parseHexColor("  #1e3a8a  ")).toBe("#1e3a8a");
  });

  // This value reaches a CSS custom property on a page anonymous strangers
  // load. `url(...)` there makes a customer's browser issue that request —
  // an unvetted outbound call from the least-trusted surface in the product.
  it("rejects anything that is not exactly #rrggbb", () => {
    for (const bad of [
      "red", "#abc", "#GGGGGG", "rgb(0,0,0)", "url(https://evil.example/x.png)",
      "#6d28d9; background:url(x)", "var(--x)", "", "   ", "#0f766e0f",
    ]) {
      expect(parseHexColor(bad)).toBeNull();
    }
    expect(parseHexColor(null)).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });
});

describe("contrastRatio", () => {
  // Pins the WCAG formula itself. If this drifts, every threshold below is
  // meaningless.
  it("gives 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#6d28d9", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#6d28d9"), 10);
  });

  it("matches measured values for the colors this feature cares about", () => {
    expect(contrastRatio("#6d28d9", "#ffffff")).toBeCloseTo(7.10, 2);
    expect(contrastRatio("#8b5cf6", SIDEBAR_BG)).toBeCloseTo(3.96, 2);
    expect(contrastRatio("#1e3a8a", SIDEBAR_BG)).toBeCloseTo(1.62, 2);
  });
});

describe("readableTextOn", () => {
  it("picks white on dark colors and near-black on light ones", () => {
    expect(readableTextOn("#6d28d9")).toBe("#ffffff");
    expect(readableTextOn("#1e3a8a")).toBe("#ffffff");
    expect(readableTextOn("#000000")).toBe("#ffffff");
    expect(readableTextOn("#fde047")).toBe("#111111");
    expect(readableTextOn("#ffffff")).toBe("#111111");
  });
});

describe("lightenForSidebar", () => {
  // The sidebar is always dark (#1e1b2e). A navy brand is invisible there
  // untreated — 1.62:1 — which is the whole reason this function exists.
  it("raises a too-dark color past 3:1 against the sidebar", () => {
    const out = lightenForSidebar("#1e3a8a");
    expect(out).not.toBe("#1e3a8a");
    expect(contrastRatio(out, SIDEBAR_BG)).toBeGreaterThanOrEqual(3);
  });

  it("leaves a color that already clears 3:1 untouched", () => {
    expect(lightenForSidebar("#0f766e")).toBe("#0f766e"); // measured 3.07
    expect(lightenForSidebar("#8b5cf6")).toBe("#8b5cf6"); // measured 3.96
    expect(lightenForSidebar("#fde047")).toBe("#fde047"); // measured 12.73
  });

  // Fidelity over legibility, decided in spec section 5: a company's hue is
  // never silently changed, only lightened.
  it("preserves hue", () => {
    expect(lightenForSidebar("#1e3a8a")).toBe("#3a62d4");
  });

  it("handles an achromatic color without dividing by zero", () => {
    const out = lightenForSidebar("#000000");
    expect(contrastRatio(out, SIDEBAR_BG)).toBeGreaterThanOrEqual(3);
  });
});

describe("resolvers", () => {
  it("falls back to BIS violet with white text when unset", () => {
    expect(resolveFormAccent(null)).toEqual({
      accent: FORM_ACCENT_FALLBACK, accentForeground: "#ffffff",
    });
    expect(resolveSidebarAccent(null)).toBeNull();
  });

  // The second half of the validate-twice rule. A row written by some future
  // path that forgot to check must not reach CSS.
  it("treats an invalid stored value as unset", () => {
    expect(resolveFormAccent("url(https://evil.example/x.png)")).toEqual({
      accent: FORM_ACCENT_FALLBACK, accentForeground: "#ffffff",
    });
    expect(resolveSidebarAccent("red")).toBeNull();
  });

  it("resolves a valid color differently for each surface", () => {
    // Same brand, two answers: the form shows it as-is, the sidebar lightens
    // it to stay visible on a dark background.
    expect(resolveFormAccent("#1e3a8a")).toEqual({
      accent: "#1e3a8a", accentForeground: "#ffffff",
    });
    expect(resolveSidebarAccent("#1e3a8a")).toBe("#3a62d4");
  });
});

describe("ensureContrast", () => {
  it("lightens a dark colour on a dark surface", () => {
    const out = ensureContrast("#1e3a8a", "#111721", 3)!;
    expect(contrastRatio(out, "#111721")).toBeGreaterThanOrEqual(3);
    expect(out).not.toBe("#1e3a8a");
  });

  it("darkens a light colour on a light surface", () => {
    const out = ensureContrast("#ffffff", "#f8fafc", 3)!;
    expect(contrastRatio(out, "#f8fafc")).toBeGreaterThanOrEqual(3);
  });

  it("returns the input untouched when it already clears", () => {
    expect(ensureContrast("#000000", "#ffffff", 3)).toBe("#000000");
  });

  // A synthetic target, NOT one of the ramps: every real ladder can lift every
  // adversarial colour to 3:1 (verified), so no ramp value reaches this branch.
  // Asserting it against a real surface would produce a test that passes for
  // the wrong reason and invites someone to "fix" working code.
  it("gives up rather than returning something unreadable", () => {
    expect(ensureContrast("#808080", "#808080", 21)).toBeNull();
  });
});
