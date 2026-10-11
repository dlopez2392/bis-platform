import { describe, it, expect } from "vitest";
import { RELATIONSHIP_KEYS } from "@bis/db/relationship-keys";
import { RELATIONSHIP_LABELS, relationshipOptions, formChoices, wordFor, chipText, chipFormControl } from "./relationship-labels";
import type { RelationshipView } from "./relationship-view";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;
const NAMES = { hidden: "someone not on your list", noName: "(no name)" };
const view = (over: Partial<RelationshipView>): RelationshipView => ({
  id: "r1", labelKey: "parent", customLabel: null, namedSide: "a",
  person: { id: "p1", firstName: "Ana", lastName: "Ramírez" }, namedForm: null, subjectForm: null,
  canPickUp: false, isEmergency: false, lockedFlag: null, ...over,
});

describe("the registry (spec §4.2): every pair reads from both sides in both languages", () => {
  for (const key of RELATIONSHIP_KEYS) {
    it(`${key}: sides a and b, English and Spanish, a neutral word, f with m (mutation: delete one es.b -> FAILS naming the key)`, () => {
      const entry = RELATIONSHIP_LABELS[key];
      for (const side of ["a", "b"] as const) {
        for (const locale of ["en", "es"] as const) {
          const forms = entry[side].words[locale];
          expect(forms, `${key}.${side}.${locale}`).toBeDefined();
          if (key !== "other") expect(forms.n.length, `${key}.${side}.${locale}.n`).toBeGreaterThan(0);
          expect(Boolean(forms.f), `${key}.${side}.${locale} f/m pair`).toBe(Boolean(forms.m));
          for (const w of [forms.n, forms.f, forms.m].filter(Boolean) as string[]) {
            expect(w, `${key}.${side}.${locale}`).not.toMatch(/[{}]/);
            expect(w).not.toMatch(INTERNAL_MILESTONE);
            expect(w).not.toContain("/");
          }
        }
      }
      if (entry.symmetric) expect(entry.b).toEqual(entry.a);
      expect(entry.offer.length).toBeGreaterThan(0);
      for (const side of entry.offer) {
        expect(entry[side].pick?.en, `${key}.${side} pick`).toBeTruthy();
        expect(entry[side].pick?.es, `${key}.${side} pick es`).toBeTruthy();
      }
    });
  }
  it("neutral Spanish uses the 'X o Y' form (C7; mutation: write 'Madre/padre' -> FAILS)", () => {
    expect(RELATIONSHIP_LABELS.parent.a.words.es.n).toBe("Madre o padre");
    expect(RELATIONSHIP_LABELS.parent.b.words.es.n).toBe("Hijo o hija");
    expect(RELATIONSHIP_LABELS.godparent.a.words.es.n).toBe("Padrino o madrina");
    expect(RELATIONSHIP_LABELS.compadre.a.words.es.n).toBe("Compadre o comadre");
  });
});

describe("chipText: the word names the OTHER person, in that person's form", () => {
  it("Sofía's record names her mother; Ana's names her daughter (mutation: use subjectForm for the named word -> FAILS)", () => {
    expect(chipText(view({ namedSide: "a", namedForm: "f", subjectForm: "f" }), "en", NAMES)).toBe("Mother: Ana Ramírez");
    expect(chipText(view({ namedSide: "a", namedForm: "f", subjectForm: "m" }), "es", NAMES)).toBe("Madre: Ana Ramírez");
    expect(chipText(view({ namedSide: "b", namedForm: "f", person: { id: "p2", firstName: "Sofía", lastName: "Ramírez" } }), "es", NAMES)).toBe("Hija: Sofía Ramírez");
    expect(chipText(view({ namedSide: "a" }), "es", NAMES)).toBe("Madre o padre: Ana Ramírez");
  });
  it("phrase-shaped sides read without a colon", () => {
    expect(chipText(view({ labelKey: "emergency_contact", namedSide: "b" }), "en", NAMES)).toBe("Emergency contact for Ana Ramírez");
    expect(chipText(view({ labelKey: "caregiver", namedSide: "b" }), "es", NAMES)).toBe("Cuida a Ana Ramírez");
  });
  it("Spanish 'referred' agrees with the record's own customer (mutation: drop esAgreesWithSubject -> FAILS)", () => {
    expect(chipText(view({ labelKey: "referred", namedSide: "a", namedForm: "m", subjectForm: "f" }), "es", NAMES)).toBe("Referida por Ana Ramírez");
    expect(chipText(view({ labelKey: "referred", namedSide: "a", namedForm: "f", subjectForm: null }), "es", NAMES)).toBe("Recomendación de Ana Ramírez");
    expect(chipText(view({ labelKey: "referred", namedSide: "a", subjectForm: "f" }), "en", NAMES)).toBe("Referred by Ana Ramírez");
  });
  it("'Other' shows the typed label as-is in both languages", () => {
    expect(chipText(view({ labelKey: "other", customLabel: "Vecina" }), "en", NAMES)).toBe("Vecina: Ana Ramírez");
    expect(chipText(view({ labelKey: "other", customLabel: "Vecina" }), "es", NAMES)).toBe("Vecina: Ana Ramírez");
  });
  it("a person the reader may not see reads as the hidden-person words (C5)", () => {
    expect(chipText(view({ person: null, namedForm: "f" }), "en", NAMES)).toBe("Mother: someone not on your list");
  });
});

describe("the dialog's choices", () => {
  it("offers both directions of an asymmetric label and the helper side of a support label, with the customer's name", () => {
    const options = relationshipOptions("en", "Sofía");
    const labels = options.map((o) => o.label);
    expect(labels).toContain("Parent");
    expect(labels).toContain("Child");
    expect(labels).toContain("Referred Sofía");
    expect(labels).toContain("Was referred by Sofía");
    expect(options.filter((o) => o.key === "emergency_contact").map((o) => o.side)).toEqual(["a"]);
    expect(options.filter((o) => o.key === "spouse")).toHaveLength(1);
    expect(relationshipOptions("es", "Sofía").map((o) => o.label)).toContain("Padrino o madrina");
  });
  it("word-form rows: the other person's for a family word; the subject's for Spanish 'referred' side a (mutation: ignore esAgreesWithSubject -> FAILS)", () => {
    expect(formChoices("parent", "a", "es", "other")).toEqual({ n: "Madre o padre", f: "Madre", m: "Padre" });
    expect(formChoices("parent", "a", "es", "subject")).toEqual({ n: "Hijo o hija", f: "Hija", m: "Hijo" });
    expect(formChoices("referred", "a", "es", "other")).toBeNull();
    expect(formChoices("referred", "a", "es", "subject")).toEqual({ n: "Recomendación de", f: "Referida por", m: "Referido por" });
    expect(formChoices("emergency_contact", "a", "en", "other")).toBeNull();
  });
  it("wordFor falls back to the neutral word", () => {
    expect(wordFor("landlord", "b", "es", null, null)).toBe("Inquilino o inquilina");
    expect(wordFor("landlord", "b", "es", "f", null)).toBe("Inquilina");
  });
  it("a chip's form control: the named person's, the subject's for Spanish 'referred', none for a hidden person or a neutral-only word", () => {
    expect(chipFormControl(view({ namedForm: "f" }), "en")).toEqual({ who: "named", choices: { n: "Parent", f: "Mother", m: "Father" }, value: "f" });
    expect(chipFormControl(view({ labelKey: "referred", namedSide: "a", subjectForm: "m" }), "es")?.who).toBe("subject");
    expect(chipFormControl(view({ person: null }), "en")).toBeNull();
    expect(chipFormControl(view({ labelKey: "responsible_party" }), "es")).toBeNull();
  });
});
