import { describe, it, expect } from "vitest";
import { resolveCssLength } from "./safe-theme";

// This is now the only test of the length rule. `resolveFormRadius` and its
// own describe block went with M4b — the public form's corners arrive with
// the tenant token set, through themeStyle, through this same function — so
// the cases that were unique to it moved here rather than being deleted with
// it: the semicolon vector in particular is the whole reason the rule exists.
describe("resolveCssLength", () => {
  it("accepts the same plain lengths and returns the caller's fallback", () => {
    for (const good of ["0.5rem", "8px", "1.25em", "50%", "0px"]) {
      expect(resolveCssLength(good, "9rem")).toBe(good);
    }
    expect(resolveCssLength("", "9rem")).toBe("9rem");
    expect(resolveCssLength("   ", "9rem")).toBe("9rem");
    expect(resolveCssLength(undefined, "9rem")).toBe("9rem");
    expect(resolveCssLength(null, "9rem")).toBe("9rem");
  });

  // The real risk: React does not strip `;` from a style attribute value, so
  // an unvalidated length lets a stored row add arbitrary extra CSS
  // declarations onto a customer-facing element (see
  // docs/superpowers/specs/2026-08-08-brand-color-design.md §4). Any value
  // containing `;` must never pass through.
  it("refuses a smuggled declaration and CSS it cannot prove is safe", () => {
    for (const bad of [
      "9px;position:fixed", "0.5rem; background:url(https://evil.example/x.png)",
      "calc(1rem + 2px)", "var(--x)", "1", "rem", "-4px", "8 px",
      "expression(alert(1))",
    ]) {
      expect(resolveCssLength(bad, "9rem"), bad).toBe("9rem");
    }
  });
});
