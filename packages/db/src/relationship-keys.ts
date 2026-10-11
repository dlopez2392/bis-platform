/**
 * Relationships between customers (spec §4.1, migration 0070): the fixed list of label keys and
 * the row shape. Dependency-free on purpose: apps/web's client components import it through
 * "@bis/db/relationship-keys" without pulling supabase-js into the browser bundle. 0070's
 * contact_relationships_label_key CHECK lists exactly these keys, and
 * contact-relationships-schema.test.ts compares the two.
 */
export const RELATIONSHIP_KEYS = [
  "parent", "spouse", "sibling", "godparent", "compadre", "emergency_contact",
  "authorized_pickup", "responsible_party", "caregiver", "landlord", "referred", "other",
] as const;
export type RelationshipKey = (typeof RELATIONSHIP_KEYS)[number];

/** A person's grammatical form for one relationship's words (spec C1). Null is the neutral word. */
export type WordForm = "f" | "m";

export function isRelationshipKey(v: unknown): v is RelationshipKey {
  return typeof v === "string" && (RELATIONSHIP_KEYS as readonly string[]).includes(v);
}

/** One row, read "contact_id is related_contact_id's label_key" (spec §4.2). */
export type RelationshipRow = {
  id: string;
  account_id: string;
  contact_id: string;
  related_contact_id: string;
  label_key: RelationshipKey;
  custom_label: string | null;
  contact_form: WordForm | null;
  related_form: WordForm | null;
  contact_can_pick_up: boolean;
  contact_is_emergency: boolean;
  related_can_pick_up: boolean;
  related_is_emergency: boolean;
  created_at: string;
  updated_at: string;
};

export const RELATIONSHIP_COLUMNS =
  "id, account_id, contact_id, related_contact_id, label_key, custom_label, contact_form, related_form, " +
  "contact_can_pick_up, contact_is_emergency, related_can_pick_up, related_is_emergency, created_at, updated_at";

/** The other person on a relationship, as the caller's RLS lets them read it. */
export type RelatedPerson = { id: string; first_name: string | null; last_name: string | null };

/** The only columns the client role may update (0070's column grant), the per-side forms and flags. */
export const SIDE_COLUMNS = [
  "contact_form", "related_form", "contact_can_pick_up", "contact_is_emergency", "related_can_pick_up", "related_is_emergency",
] as const;
export type SideColumn = (typeof SIDE_COLUMNS)[number];
export type RelationshipSidesPatch = Partial<Pick<RelationshipRow, SideColumn>>;
