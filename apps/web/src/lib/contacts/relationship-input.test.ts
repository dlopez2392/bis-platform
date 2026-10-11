import { describe, it, expect } from "vitest";
import { cleanCustomLabel, parseAddInput, parseViewPatch, parseSidesPatch, parseRelationshipRow } from "./relationship-input";

const S = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const ok = { subjectId: S, other: { kind: "existing", contactId: O }, labelKey: "parent", side: "a", customLabel: null, otherForm: "f", subjectForm: null };
const ROW = {
  id: "33333333-3333-4333-8333-333333333333", account_id: "44444444-4444-4444-8444-444444444444",
  contact_id: O, related_contact_id: S, label_key: "other", custom_label: "Vecina", contact_form: null, related_form: "f",
  contact_can_pick_up: false, contact_is_emergency: false, related_can_pick_up: true, related_is_emergency: false,
  created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};

describe("cleanCustomLabel", () => {
  it("strips edge whitespace with an explicit class, zero-width space included (mutation: use .trim() -> FAILS)", () => {
    expect(cleanCustomLabel("​ Vecina  ")).toBe("Vecina");
  });
  it("counts characters, not UTF-16 units, against 60 (mutation: use .length -> FAILS)", () => {
    expect(cleanCustomLabel("🙂".repeat(60))).toBe("🙂".repeat(60));
    expect(cleanCustomLabel("x".repeat(61))).toBeNull();
    expect(cleanCustomLabel("   ")).toBeNull();
    expect(cleanCustomLabel(7)).toBeNull();
  });
});

describe("cleanCustomLabel's edge class matches 0070's CHECK (PG17 ICU en_US.UTF-8 POSIX [:space:])", () => {
  // Every code point PG's [:space:] treats as space in that locale (production/bis-ci), so
  // app-side cleaning never leaves something the database's CHECK (contact_relationships_custom)
  // still calls leading/trailing space, which would otherwise surface as a misleading 23514.
  const POSIX_SPACE_POINTS = [
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, // U+0009-000D
    0x001c, 0x001d, 0x001e, 0x001f, // U+001C-001F
    0x0020, // U+0020
    0x0085, // U+0085
    0x00a0, // U+00A0
    0x1680, // U+1680
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, // U+2000-200A
    0x2028, // U+2028
    0x2029, // U+2029
    0x202f, // U+202F
    0x205f, // U+205F
    0x3000, // U+3000
  ];
  for (const cp of POSIX_SPACE_POINTS) {
    const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    it(`${hex} at the edges is stripped (mutation: remove U+0085 from EDGE_SPACE -> FAILS naming U+0085)`, () => {
      const ch = String.fromCodePoint(cp);
      expect(cleanCustomLabel(`${ch}Vecina${ch}`)).toBe("Vecina");
    });
  }
});

describe("parseAddInput (the server re-validates what the browser sent)", () => {
  it("accepts a well-formed add", () => expect(parseAddInput(ok)).toEqual({ ok: true, input: ok }));
  it("refuses oneself as self", () => expect(parseAddInput({ ...ok, other: { kind: "existing", contactId: S } })).toEqual({ ok: false, error: "self" }));
  it("refuses a side the label does not offer (mutation: skip the offer check -> FAILS)", () =>
    expect(parseAddInput({ ...ok, labelKey: "emergency_contact", side: "b" })).toEqual({ ok: false, error: "invalid" }));
  it("refuses an unknown key, a bad form, a missing 'Other' text, a non-uuid", () => {
    for (const bad of [{ ...ok, labelKey: "cousin" }, { ...ok, otherForm: "x" }, { ...ok, labelKey: "other", customLabel: " " }, { ...ok, subjectId: "nope" }]) {
      expect(parseAddInput(bad)).toEqual({ ok: false, error: "invalid" });
    }
  });
  it("a new person needs a first or last name; the custom label is cleaned and kept only for 'Other'", () => {
    expect(parseAddInput({ ...ok, other: { kind: "new", firstName: " ", lastName: "", phone: "" } })).toEqual({ ok: false, error: "invalid" });
    const r = parseAddInput({ ...ok, labelKey: "other", customLabel: " Vecina ", other: { kind: "new", firstName: " Ana ", lastName: "", phone: "956 555 0142" } });
    expect(r).toEqual({ ok: true, input: { ...ok, labelKey: "other", customLabel: "Vecina", other: { kind: "new", firstName: "Ana", lastName: "", phone: "956 555 0142" } } });
  });
});

describe("patches and the Undo snapshot", () => {
  it("parseViewPatch takes the four view keys only", () => {
    expect(parseViewPatch({ canPickUp: true })).toEqual({ canPickUp: true });
    expect(parseViewPatch({ namedForm: null, subjectForm: "m" })).toEqual({ namedForm: null, subjectForm: "m" });
    expect(parseViewPatch({})).toBeNull();
    expect(parseViewPatch({ canPickUp: "yes" })).toBeNull();
    expect(parseViewPatch({ label_key: "spouse" })).toBeNull();
  });
  it("parseSidesPatch takes side columns with their own types only (mutation: accept any key -> FAILS)", () => {
    expect(parseSidesPatch({ contact_form: "f", related_is_emergency: false })).toEqual({ contact_form: "f", related_is_emergency: false });
    expect(parseSidesPatch({ contact_form: true })).toBeNull();
    expect(parseSidesPatch({ label_key: "spouse" })).toBeNull();
    expect(parseSidesPatch({})).toBeNull();
  });
  it("parseRelationshipRow accepts exactly a stored row's shape", () => {
    expect(parseRelationshipRow(ROW)).toEqual(ROW);
    expect(parseRelationshipRow({ ...ROW, custom_label: " Vecina" })).toBeNull();
    expect(parseRelationshipRow({ ...ROW, label_key: "parent" })).toBeNull();
    expect(parseRelationshipRow({ ...ROW, contact_id: S })).toBeNull();
    expect(parseRelationshipRow({ ...ROW, extra: 1 })).toBeNull();
    expect(parseRelationshipRow({ ...ROW, label_key: "other", custom_label: null })).toBeNull();
  });
});
