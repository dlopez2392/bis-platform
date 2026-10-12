/**
 * Database refusals on properties and equipment become copy keys, by SQLSTATE, never by message
 * wording (spec §6). places.ts keeps PostgREST's code on its PlaceDbError, and a raw PostgREST
 * error carries the same `code`, so this reads the code off either shape without importing @bis/db
 * (the card can import this module too).
 *
 * 23514 is "Check the details and try again.": place-input.ts re-checks every CHECK 0071 has before
 * a write, so a 23514 reaching here means the app and 0071 disagree, and the action logs it.
 * 23503 outside an Undo is a target that changed under the caller: a unit something has since
 * replaced (equipment_replaces_fkey, C6), or a place that vanished before a unit was added to it.
 * The codes whose meaning depends on the action are mapped by the action itself: the owner guard's
 * 42501 is places.moveRefused, and an Undo's 23505 or 23503 is places.error.undoFailed (spec §7).
 */
export type PlaceErrorKey =
  | "places.refused" | "places.moveRefused" | "equipment.alreadyReplaced"
  | "places.error.undoFailed" | "places.error.invalid" | "places.error.failed";

export function placeErrorCode(e: unknown): string | undefined {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

export function placeErrorFor(e: unknown): PlaceErrorKey {
  const code = placeErrorCode(e);
  if (code === "42501") return "places.refused";
  if (code === "23505") return "equipment.alreadyReplaced";
  if (code === "23503") return "places.refused";
  if (code === "23514") return "places.error.invalid";
  return "places.error.failed";
}
