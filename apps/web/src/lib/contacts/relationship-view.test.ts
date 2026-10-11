import { describe, it, expect } from "vitest";
import type { RelationshipRow } from "@bis/db/relationship-keys";
import { toRelationshipView, columnsForViewPatch, newRelationshipFor, previewPair } from "./relationship-view";

const S = "11111111-1111-4111-8111-111111111111"; // the record's own customer
const O = "22222222-2222-4222-8222-222222222222"; // the other person
const row = (over: Partial<RelationshipRow>): RelationshipRow => ({
  id: "33333333-3333-4333-8333-333333333333", account_id: "44444444-4444-4444-8444-444444444444",
  contact_id: O, related_contact_id: S, label_key: "parent", custom_label: null, contact_form: "f", related_form: "m",
  contact_can_pick_up: true, contact_is_emergency: false, related_can_pick_up: false, related_is_emergency: true,
  created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z", ...over,
});
const PEOPLE = [{ id: O, first_name: "Ana", last_name: "Ramírez" }];

describe("toRelationshipView (spec §4.2)", () => {
  it("names the other person with their own side's form and flags (mutation: read the subject's flags -> FAILS)", () => {
    expect(toRelationshipView(row({}), S, PEOPLE)).toEqual({
      id: row({}).id, labelKey: "parent", customLabel: null, namedSide: "a",
      person: { id: O, firstName: "Ana", lastName: "Ramírez" }, namedForm: "f", subjectForm: "m",
      canPickUp: true, isEmergency: false, lockedFlag: null,
    });
    const flipped = toRelationshipView(row({ contact_id: S, related_contact_id: O }), S, PEOPLE)!;
    expect(flipped).toMatchObject({ namedSide: "b", namedForm: "m", subjectForm: "f", canPickUp: false, isEmergency: true });
  });
  it("a person the caller cannot read is null, and no id of theirs survives (C5)", () => {
    const v = toRelationshipView(row({}), S, [])!;
    expect(v.person).toBeNull();
    expect(JSON.stringify(v)).not.toContain(O);
  });
  it("locks the flag a support label already is, on side a only", () => {
    expect(toRelationshipView(row({ label_key: "emergency_contact", contact_is_emergency: true }), S, PEOPLE)!.lockedFlag).toBe("isEmergency");
    expect(toRelationshipView(row({ label_key: "authorized_pickup", contact_id: S, related_contact_id: O }), S, PEOPLE)!.lockedFlag).toBeNull();
  });
  it("a row that is not about this customer has no view", () => {
    expect(toRelationshipView(row({ contact_id: O, related_contact_id: "55555555-5555-4555-8555-555555555555" }), S, PEOPLE)).toBeNull();
  });
});

describe("columnsForViewPatch: the view's words map back to the right side's columns", () => {
  it("named on side a writes contact_*; named on side b writes related_* (mutation: swap the sides -> FAILS)", () => {
    expect(columnsForViewPatch(row({}), S, { canPickUp: false, namedForm: null })).toEqual({ contact_can_pick_up: false, contact_form: null });
    expect(columnsForViewPatch(row({ contact_id: S, related_contact_id: O }), S, { isEmergency: true, subjectForm: "f" }))
      .toEqual({ related_is_emergency: true, contact_form: "f" });
    expect(columnsForViewPatch(row({ contact_id: O, related_contact_id: "55555555-5555-4555-8555-555555555555" }), S, { canPickUp: true })).toBeNull();
  });
});

describe("newRelationshipFor and previewPair", () => {
  it("the other person on side a is contact_id; a support label sets its flag", () => {
    expect(newRelationshipFor({ subjectId: S, otherId: O, labelKey: "emergency_contact", otherSide: "a", customLabel: null, otherForm: null, subjectForm: "f" }))
      .toEqual({ contactId: O, relatedContactId: S, labelKey: "emergency_contact", customLabel: null, contactForm: null, relatedForm: "f",
        contactCanPickUp: false, contactIsEmergency: true, relatedCanPickUp: false, relatedIsEmergency: false });
    expect(newRelationshipFor({ subjectId: S, otherId: O, labelKey: "parent", otherSide: "b", customLabel: "ignored", otherForm: "m", subjectForm: "f" }))
      .toMatchObject({ contactId: S, relatedContactId: O, contactForm: "f", relatedForm: "m", customLabel: null });
  });
  it("previews both records", () => {
    const p = previewPair({ labelKey: "parent", otherSide: "b", customLabel: null, otherForm: "f", subjectForm: "f",
      subject: { firstName: "Sofía", lastName: "Ramírez" }, other: { firstName: "Ana", lastName: "Ramírez" } });
    expect(p.onSubject).toMatchObject({ namedSide: "b", namedForm: "f", person: { firstName: "Ana" } });
    expect(p.onOther).toMatchObject({ namedSide: "a", namedForm: "f", person: { firstName: "Sofía" } });
  });
});
