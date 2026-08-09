import { describe, it, expect } from "vitest";
import { resolveFormRadius, FORM_RADIUS_FALLBACK } from "./safe-theme";

describe("resolveFormRadius", () => {
  it("accepts a plain CSS length with an allowed unit", () => {
    for (const good of ["0.5rem", "8px", "1.25em", "50%", "0px"]) {
      expect(resolveFormRadius(good)).toBe(good);
    }
  });

  it("falls back on empty, whitespace, undefined, or null", () => {
    expect(resolveFormRadius("")).toBe(FORM_RADIUS_FALLBACK);
    expect(resolveFormRadius("   ")).toBe(FORM_RADIUS_FALLBACK);
    expect(resolveFormRadius(undefined)).toBe(FORM_RADIUS_FALLBACK);
    expect(resolveFormRadius(null)).toBe(FORM_RADIUS_FALLBACK);
  });

  // The real risk: React does not strip `;` from a style attribute value, so
  // an unvalidated theme.radius lets a stored row add arbitrary extra CSS
  // declarations onto the customer-facing form element (see
  // docs/superpowers/specs/2026-08-08-brand-color-design.md §4). Any value
  // containing `;` must never pass through.
  it("rejects a value containing a semicolon, the CSS-injection vector", () => {
    expect(resolveFormRadius("0.5rem; background:url(https://evil.example/x.png)"))
      .toBe(FORM_RADIUS_FALLBACK);
  });

  it("rejects anything that is not a plain CSS length", () => {
    for (const bad of [
      "var(--x)", "calc(1rem + 2px)", "1", "rem", "-1rem", "expression(alert(1))",
    ]) {
      expect(resolveFormRadius(bad)).toBe(FORM_RADIUS_FALLBACK);
    }
  });
});
