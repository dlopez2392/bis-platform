import type { Locale } from "@/lib/i18n/locale";
import { RELATIONSHIP_KEYS, type RelationshipKey, type WordForm } from "@bis/db/relationship-keys";
import type { RelationshipView } from "./relationship-view";

/**
 * The bilingual relationship words (spec §4.2, F-003). Side a names contact_id (shown on
 * related_contact_id's record); side b names related_contact_id. A word takes the form of the
 * person it describes; Spanish "referred" side a describes the record's own customer instead.
 * Neutral Spanish is "X o Y" (C7). Kept out of messages.ts on purpose (spec §4.1); its own test
 * is its completeness gate.
 */
export type Forms = { readonly n: string; readonly f?: string; readonly m?: string };
export type SideWords = {
  readonly en: Forms;
  readonly es: Forms;
  /** "colon": "Mother: Ana Ramírez". "phrase": "Emergency contact for Ana Ramírez". */
  readonly shape: "colon" | "phrase";
  readonly esAgreesWithSubject?: true;
};
export type Side = { readonly words: SideWords; readonly pick?: { readonly en: string; readonly es: string } };
export type LabelEntry = { readonly symmetric: boolean; readonly a: Side; readonly b: Side; readonly offer: readonly ("a" | "b")[] };

const both = (s: Side): { a: Side; b: Side } => ({ a: s, b: s });

export const RELATIONSHIP_LABELS: Readonly<Record<RelationshipKey, LabelEntry>> = {
  parent: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "colon", en: { n: "Parent", f: "Mother", m: "Father" }, es: { n: "Madre o padre", f: "Madre", m: "Padre" } },
      pick: { en: "Parent", es: "Madre o padre" } },
    b: { words: { shape: "colon", en: { n: "Child", f: "Daughter", m: "Son" }, es: { n: "Hijo o hija", f: "Hija", m: "Hijo" } },
      pick: { en: "Child", es: "Hijo o hija" } },
  },
  spouse: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "Spouse", f: "Wife", m: "Husband" }, es: { n: "Esposo o esposa", f: "Esposa", m: "Esposo" } },
      pick: { en: "Spouse", es: "Esposo o esposa" } }),
  },
  sibling: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "Sibling", f: "Sister", m: "Brother" }, es: { n: "Hermano o hermana", f: "Hermana", m: "Hermano" } },
      pick: { en: "Sibling", es: "Hermano o hermana" } }),
  },
  godparent: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "colon", en: { n: "Godparent", f: "Godmother", m: "Godfather" }, es: { n: "Padrino o madrina", f: "Madrina", m: "Padrino" } },
      pick: { en: "Godparent", es: "Padrino o madrina" } },
    b: { words: { shape: "colon", en: { n: "Godchild", f: "Goddaughter", m: "Godson" }, es: { n: "Ahijado o ahijada", f: "Ahijada", m: "Ahijado" } },
      pick: { en: "Godchild", es: "Ahijado o ahijada" } },
  },
  compadre: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "Compadre or comadre", f: "Comadre", m: "Compadre" }, es: { n: "Compadre o comadre", f: "Comadre", m: "Compadre" } },
      pick: { en: "Compadre or comadre", es: "Compadre o comadre" } }),
  },
  emergency_contact: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Emergency contact" }, es: { n: "Contacto de emergencia" } },
      pick: { en: "Emergency contact", es: "Contacto de emergencia" } },
    b: { words: { shape: "phrase", en: { n: "Emergency contact for" }, es: { n: "Contacto de emergencia de" } } },
  },
  authorized_pickup: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Authorized pickup" }, es: { n: "Puede recoger" } },
      pick: { en: "Authorized pickup", es: "Puede recoger" } },
    b: { words: { shape: "phrase", en: { n: "Authorized to pick up" }, es: { n: "Puede recoger a" } } },
  },
  responsible_party: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Responsible party" }, es: { n: "Responsable" } },
      pick: { en: "Responsible party", es: "Responsable" } },
    b: { words: { shape: "phrase", en: { n: "Responsible for" }, es: { n: "Responsable de" } } },
  },
  caregiver: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Caregiver" }, es: { n: "Cuidador o cuidadora", f: "Cuidadora", m: "Cuidador" } },
      pick: { en: "Caregiver", es: "Cuidador o cuidadora" } },
    b: { words: { shape: "phrase", en: { n: "Cares for" }, es: { n: "Cuida a" } } },
  },
  landlord: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "colon", en: { n: "Landlord" }, es: { n: "Arrendador o arrendadora", f: "Arrendadora", m: "Arrendador" } },
      pick: { en: "Landlord", es: "Arrendador o arrendadora" } },
    b: { words: { shape: "colon", en: { n: "Tenant" }, es: { n: "Inquilino o inquilina", f: "Inquilina", m: "Inquilino" } },
      pick: { en: "Tenant", es: "Inquilino o inquilina" } },
  },
  referred: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "phrase", esAgreesWithSubject: true, en: { n: "Referred by" }, es: { n: "Recomendación de", f: "Referida por", m: "Referido por" } },
      pick: { en: "Referred {subject}", es: "Refirió a {subject}" } },
    b: { words: { shape: "phrase", en: { n: "Referred" }, es: { n: "Refirió a" } },
      pick: { en: "Was referred by {subject}", es: "Llegó por recomendación de {subject}" } },
  },
  other: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "" }, es: { n: "" } }, pick: { en: "Other", es: "Otra relación" } }),
  },
};

export type RelationshipOption = { value: string; key: RelationshipKey; side: "a" | "b"; label: string };

/** "Who is {name} to {customer}?": the other person's role, in the reader's language. */
export function relationshipOptions(locale: Locale, subjectName: string): RelationshipOption[] {
  const out: RelationshipOption[] = [];
  for (const key of RELATIONSHIP_KEYS) {
    const entry = RELATIONSHIP_LABELS[key];
    for (const side of entry.offer) {
      const pick = entry[side].pick;
      if (!pick) continue;
      out.push({ value: `${key}:${side}`, key, side, label: pick[locale].replaceAll("{subject}", () => subjectName) });
    }
  }
  return out;
}

export type FormChoice = { n: string; f: string; m: string };

/** The words a person's form changes, for the dialog's "Words" row; null when none change. */
export function formChoices(key: RelationshipKey, otherSide: "a" | "b", locale: Locale, who: "other" | "subject"): FormChoice | null {
  const entry = RELATIONSHIP_LABELS[key];
  const subjectSide = otherSide === "a" ? "b" : "a";
  const own = who === "other" ? otherSide : subjectSide;
  const opposite = own === "a" ? "b" : "a";
  const agrees = (s: "a" | "b") => locale === "es" && entry[s].words.esAgreesWithSubject === true;
  const candidates = [
    ...(agrees(own) ? [] : [entry[own].words[locale]]),
    ...(agrees(opposite) ? [entry[opposite].words[locale]] : []),
  ];
  const withForms = candidates.find((f) => f.f && f.m);
  return withForms ? { n: withForms.n, f: withForms.f!, m: withForms.m! } : null;
}

export function wordFor(key: RelationshipKey, side: "a" | "b", locale: Locale, namedForm: WordForm | null, subjectForm: WordForm | null): string {
  const words = RELATIONSHIP_LABELS[key][side].words;
  const forms = words[locale];
  const form = locale === "es" && words.esAgreesWithSubject ? subjectForm : namedForm;
  return (form && forms[form]) || forms.n;
}

export function personName(p: { firstName: string | null; lastName: string | null } | null, fallback: string): string {
  if (!p) return fallback;
  return [p.firstName, p.lastName].map((s) => s?.trim() ?? "").filter(Boolean).join(" ") || fallback;
}

export function chipText(view: RelationshipView, locale: Locale, names: { hidden: string; noName: string }): string {
  const name = view.person ? personName(view.person, names.noName) : names.hidden;
  const word = view.labelKey === "other" ? (view.customLabel ?? "") : wordFor(view.labelKey, view.namedSide, locale, view.namedForm, view.subjectForm);
  return RELATIONSHIP_LABELS[view.labelKey][view.namedSide].words.shape === "colon" ? `${word}: ${name}` : `${word} ${name}`;
}

export type ChipFormControl = { who: "named" | "subject"; choices: FormChoice; value: WordForm | null };

/** The inline select on a chip edits whichever person's form changes THIS chip's words. */
export function chipFormControl(view: RelationshipView, locale: Locale): ChipFormControl | null {
  if (!view.person || view.labelKey === "other") return null;
  const words = RELATIONSHIP_LABELS[view.labelKey][view.namedSide].words;
  const forms = words[locale];
  if (!forms.f || !forms.m) return null;
  const who = locale === "es" && words.esAgreesWithSubject ? "subject" : "named";
  return { who, choices: { n: forms.n, f: forms.f, m: forms.m }, value: who === "named" ? view.namedForm : view.subjectForm };
}
