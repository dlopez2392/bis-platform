import { SCREENED_REASONS, screenedClass, type ScreenedClass } from "@bis/db";

/**
 * The valid set of `?class=` values — DERIVED from `SCREENED_REASONS` run
 * through `screenedClass`, not a fourth hardcoded list of the three class
 * names. `screened-calls.ts`'s own `reasonsForClass` derives the reverse
 * direction (class → reasons) the same way, from the same two exports.
 */
const VALID_CLASSES = new Set<string>(SCREENED_REASONS.map(screenedClass));

/**
 * `?class=` on `/dashboard/screened` — which class the work-queue banner's
 * link (and any other future link) scopes the list to.
 *
 * TOTAL, like `parseTimeCursor`/`parseCursor` (`@/lib/cursor`, the house
 * precedent this follows): `?class=` is a hand-editable URL parameter, so
 * anything that is not one of the three real class names — missing, empty,
 * misspelled, or an array from a duplicated query key
 * (`?class=a&class=b`, which Next.js can hand a page's `searchParams`
 * regardless of the page's own type annotation) — reads as "no filter", the
 * cold, unfiltered list, rather than a 500 or a page that silently renders
 * everything while its own header claims to be scoped.
 *
 * `typeof raw === "string"` is a STRICT identity check ahead of the Set
 * lookup, not a coercion — `VALID_CLASSES.has(String(raw))` would look total
 * too, but `Array.prototype.toString` joins a single-element array with no
 * comma at all, so `String(["misconfigured"])` is the string
 * `"misconfigured"` and would validate an array as if it were the value
 * itself. The strict check rejects anything that is not already, actually, a
 * string.
 */
export function parseScreenedClass(raw: string | undefined): ScreenedClass | undefined {
  return typeof raw === "string" && VALID_CLASSES.has(raw) ? (raw as ScreenedClass) : undefined;
}
