/**
 * The pure decision behind i18n-overflow.spec.ts's assertions, extracted
 * so it has a unit-test seam that doesn't need a browser (Task 11, fix
 * round 1 — the reviewer's "PROVE each check can fail"). The spec itself
 * calls these two functions rather than re-deriving the same comparison
 * inline, so the unit coverage below is coverage of the spec's own logic,
 * not a parallel copy that could drift from it.
 *
 * What these do NOT prove: whether a real rendered element's `scrollWidth`/
 * `clientWidth` actually take the shape a given fix claims. That is the
 * browser's job — Playwright, run in CI, is the authority for that half.
 * These only prove the DECISION, given a pair of numbers, is the one the
 * spec intends.
 */

/**
 * `null` when the element fits; an error string naming `what` when it
 * clips. Used for: the REAL-locale sidebar check (clipping is never
 * accepted) and the dashboard KPI tiles' label/period spans (same rule).
 */
export function clipFailure(scrollWidth: number, clientWidth: number, what: string): string | null {
  return scrollWidth > clientWidth
    ? `${what} clips (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`
    : null;
}

/**
 * `null` when the element doesn't clip (title is irrelevant then) OR when
 * it clips and `title` carries the exact full text. An error string when
 * it clips WITHOUT that fallback. Used for: the pseudo-locale sidebar
 * check, where clipping itself is accepted (the real sidebar's own Link
 * tolerates it via an unconditional `title`) but losing the full text
 * entirely is not.
 */
export function pseudoTitleFallbackFailure(
  scrollWidth: number, clientWidth: number, title: string | null, text: string | null,
): string | null {
  if (scrollWidth <= clientWidth) return null;
  return title === text ? null : `clips and its title ("${title}") does not match its full text ("${text}")`;
}
