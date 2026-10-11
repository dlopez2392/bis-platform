/**
 * Database refusals become copy keys, by SQLSTATE, never by message wording (relationships spec §6).
 * 23514 is "Pick someone else." as the spec names it: every other CHECK on 0070's table (the word
 * forms, the flags, the custom label) is re-validated by relationship-input.ts before a write, so the
 * CHECK a write can still reach is contact_id <> related_contact_id.
 */
export type RelationshipError =
  | "relationships.error.duplicate" | "relationships.error.refused" | "relationships.error.self"
  | "relationships.error.gone" | "relationships.error.restore" | "relationships.error.invalid" | "relationships.error.failed";

export function relationshipErrorFor(e: unknown): RelationshipError {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  if (code === "23505") return "relationships.error.duplicate";
  if (code === "42501") return "relationships.error.refused";
  if (code === "23503") return "relationships.error.gone";
  if (code === "23514") return "relationships.error.self";
  if (code === "22023" || code === "22P02") return "relationships.error.invalid";
  return "relationships.error.failed";
}
