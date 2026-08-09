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

/** What `public-form.tsx` has always used for `--radius`. */
export const FORM_RADIUS_FALLBACK = "0.5rem";

const CSS_LENGTH = /^\d+(\.\d+)?(px|rem|em|%)$/;

/**
 * Accepts only a plain, unit-bearing, non-negative CSS length. Anything
 * else — including a technically-valid CSS value such as `calc()` or
 * `var()`, which this module has no way to prove is free of a smuggled
 * declaration — falls back.
 */
export function resolveFormRadius(radius: string | undefined | null): string {
  if (typeof radius !== "string") return FORM_RADIUS_FALLBACK;
  const v = radius.trim();
  return CSS_LENGTH.test(v) ? v : FORM_RADIUS_FALLBACK;
}
