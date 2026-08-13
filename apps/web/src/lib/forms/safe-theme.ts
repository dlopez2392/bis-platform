/**
 * Validation for stored form-theme values that reach a customer-facing
 * inline `style` attribute. Pure and I/O-free on purpose, so it can be
 * unit-tested — the same reason `branding/color.ts` is separate from the
 * surfaces that use it.
 *
 * React does not strip characters such as `;` from a style object's values
 * when serializing to the `style` attribute (verified against React
 * 19.2.4). An unvalidated value there does not enable script execution —
 * quotes are entity-escaped, so nothing can break out of the attribute —
 * but it CAN append arbitrary further CSS declarations to the element,
 * because the `;` that separates declarations passes through untouched.
 * See docs/superpowers/specs/2026-08-08-brand-color-design.md §4.
 */

const CSS_LENGTH = /^\d+(\.\d+)?(px|rem|em|%)$/;

/**
 * Accepts only a plain, unit-bearing, non-negative CSS length, and returns
 * the caller's fallback for anything else — including a technically-valid CSS
 * value such as `calc()` or `var()`, which this module has no way to prove is
 * free of a smuggled declaration.
 *
 * `resolveFormRadius`, the public form's own wrapper around this same regex,
 * is gone with M4b: the form's corners now arrive with the tenant token set,
 * validated by `themeStyle` through this function, and `forms.theme.radius`
 * is no longer read by anything. One caller-agnostic rule, one place that
 * decides what a safe CSS length is.
 */
export function resolveCssLength(value: string | undefined | null, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  return CSS_LENGTH.test(v) ? v : fallback;
}
