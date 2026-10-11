import type { NewRelationship } from "@bis/db";
import type { RelationshipKey, RelationshipRow, RelatedPerson, RelationshipSidesPatch, WordForm } from "@bis/db/relationship-keys";

/**
 * One relationship as ONE record shows it (spec §4.2): the OTHER person ("named"), their side's
 * words, their form and their flags. Built on the server; a person the caller cannot read is
 * null and carries no id (C5). Pure and client-safe.
 */
export type RelationshipView = {
  id: string;
  labelKey: RelationshipKey;
  customLabel: string | null;
  namedSide: "a" | "b";
  person: { id: string; firstName: string | null; lastName: string | null } | null;
  namedForm: WordForm | null;
  subjectForm: WordForm | null;
  canPickUp: boolean;
  isEmergency: boolean;
  /** The label already says it ("Emergency contact", "Authorized pickup" on side a): shown, never toggled. */
  lockedFlag: "canPickUp" | "isEmergency" | null;
};

export function toRelationshipView(row: RelationshipRow, subjectId: string, people: readonly RelatedPerson[]): RelationshipView | null {
  if (row.contact_id !== subjectId && row.related_contact_id !== subjectId) return null;
  const namedIsA = row.related_contact_id === subjectId;
  const namedId = namedIsA ? row.contact_id : row.related_contact_id;
  const p = people.find((x) => x.id === namedId);
  return {
    id: row.id,
    labelKey: row.label_key,
    customLabel: row.custom_label,
    namedSide: namedIsA ? "a" : "b",
    person: p ? { id: p.id, firstName: p.first_name, lastName: p.last_name } : null,
    namedForm: namedIsA ? row.contact_form : row.related_form,
    subjectForm: namedIsA ? row.related_form : row.contact_form,
    canPickUp: namedIsA ? row.contact_can_pick_up : row.related_can_pick_up,
    isEmergency: namedIsA ? row.contact_is_emergency : row.related_is_emergency,
    lockedFlag: namedIsA && row.label_key === "emergency_contact" ? "isEmergency"
      : namedIsA && row.label_key === "authorized_pickup" ? "canPickUp" : null,
  };
}

export type ViewPatch = { namedForm?: WordForm | null; subjectForm?: WordForm | null; canPickUp?: boolean; isEmergency?: boolean };

export function columnsForViewPatch(row: RelationshipRow, subjectId: string, patch: ViewPatch): RelationshipSidesPatch | null {
  if (row.contact_id !== subjectId && row.related_contact_id !== subjectId) return null;
  const namedIsA = row.related_contact_id === subjectId;
  const out: RelationshipSidesPatch = {};
  if ("namedForm" in patch) out[namedIsA ? "contact_form" : "related_form"] = patch.namedForm ?? null;
  if ("subjectForm" in patch) out[namedIsA ? "related_form" : "contact_form"] = patch.subjectForm ?? null;
  if (patch.canPickUp !== undefined) out[namedIsA ? "contact_can_pick_up" : "related_can_pick_up"] = patch.canPickUp;
  if (patch.isEmergency !== undefined) out[namedIsA ? "contact_is_emergency" : "related_is_emergency"] = patch.isEmergency;
  return out;
}

export type NewRelationshipFor = {
  subjectId: string; otherId: string; labelKey: RelationshipKey; otherSide: "a" | "b";
  customLabel: string | null; otherForm: WordForm | null; subjectForm: WordForm | null;
};

/** The dialog speaks of "the other person" and "this customer"; the row speaks of sides a and b. */
export function newRelationshipFor(i: NewRelationshipFor): NewRelationship {
  const otherIsA = i.otherSide === "a";
  return {
    contactId: otherIsA ? i.otherId : i.subjectId,
    relatedContactId: otherIsA ? i.subjectId : i.otherId,
    labelKey: i.labelKey,
    customLabel: i.labelKey === "other" ? i.customLabel : null,
    contactForm: otherIsA ? i.otherForm : i.subjectForm,
    relatedForm: otherIsA ? i.subjectForm : i.otherForm,
    contactCanPickUp: i.labelKey === "authorized_pickup",
    contactIsEmergency: i.labelKey === "emergency_contact",
    relatedCanPickUp: false,
    relatedIsEmergency: false,
  };
}

export type PreviewInput = Omit<NewRelationshipFor, "subjectId" | "otherId"> & {
  subject: { firstName: string | null; lastName: string | null };
  other: { firstName: string | null; lastName: string | null };
};

/** How both records will read, before anything is saved (the dialog's preview). */
export function previewPair(i: PreviewInput): { onSubject: RelationshipView; onOther: RelationshipView } {
  const SUBJECT = "preview-subject", OTHER = "preview-other";
  const n = newRelationshipFor({ ...i, subjectId: SUBJECT, otherId: OTHER });
  const row: RelationshipRow = {
    id: "preview", account_id: "preview", contact_id: n.contactId, related_contact_id: n.relatedContactId,
    label_key: n.labelKey, custom_label: n.customLabel, contact_form: n.contactForm, related_form: n.relatedForm,
    contact_can_pick_up: n.contactCanPickUp, contact_is_emergency: n.contactIsEmergency,
    related_can_pick_up: n.relatedCanPickUp, related_is_emergency: n.relatedIsEmergency, created_at: "", updated_at: "",
  };
  const people = [
    { id: SUBJECT, first_name: i.subject.firstName, last_name: i.subject.lastName },
    { id: OTHER, first_name: i.other.firstName, last_name: i.other.lastName },
  ];
  return { onSubject: toRelationshipView(row, SUBJECT, people)!, onOther: toRelationshipView(row, OTHER, people)! };
}
