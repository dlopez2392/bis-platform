import type { ContactLanguage, LanguageSource, LanguageSignalSource } from "@bis/db";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language-options";

/** The seven 0076 columns, as getContact reads them. */
export type ContactLanguageFacts = {
  language: ContactLanguage | null; language_source: LanguageSource | null; language_set_at: string | null;
  last_language_signal: ContactLanguage | null; last_language_signal_source: LanguageSignalSource | null;
  last_language_signal_at: string | null; language_hint_kept_at: string | null;
};

/** The record's Language line, built on the server in the reader's language (S-09 §8.2). */
export type LanguageView = {
  value: ContactLanguage | null;
  /** The endonym ("English" / "Español"), null when not set. */
  valueLabel: string | null;
  /** "from their booking (Oct 3)" when set; the whole Not set sentence when not. */
  phrase: string;
  hint: { language: ContactLanguage; text: string } | null;
};

export const LANGUAGE_ENDONYM: Readonly<Record<ContactLanguage, string>> =
  Object.fromEntries(LANGUAGE_OPTIONS.map((o) => [o.value, o.label])) as Record<ContactLanguage, string>;

/**
 * C6 / Q2: no public page offers a language choice, so a page's language is the business's default
 * unless it differs from what the customer would get anyway (the account's language, else English).
 * Only then is it the customer's sign.
 */
export function pageLanguageSignal(locale: ContactLanguage, accountLanguage: ContactLanguage | null): ContactLanguage | null {
  return locale === (accountLanguage ?? "en") ? null : locale;
}

const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/** §7.4, computed on read (C4): a later sign that disagrees, not answered by a staff choice or a Keep since. */
export function languageHint(c: ContactLanguageFacts): { language: ContactLanguage; source: LanguageSignalSource } | null {
  if (c.language === null || c.language_set_at === null) return null;
  if (c.last_language_signal === null || c.last_language_signal_source === null || c.last_language_signal_at === null) return null;
  if (c.last_language_signal === c.language) return null;
  if (!after(c.last_language_signal_at, c.language_set_at)) return null;
  if (c.language_hint_kept_at !== null && !after(c.last_language_signal_at, c.language_hint_kept_at)) return null;
  return { language: c.last_language_signal, source: c.last_language_signal_source };
}

const NAME_KEY: Record<ContactLanguage, MessageKey> = { en: "language.name.en", es: "language.name.es" };
const FROM_KEY: Record<LanguageSource, MessageKey> = {
  booking: "contact.language.from.booking", form: "contact.language.from.form",
  call: "contact.language.from.call", staff: "contact.language.from.staff",
};
const HINT_KEY: Record<LanguageSignalSource, MessageKey> = {
  booking: "contact.language.hint.booking", form: "contact.language.hint.form", call: "contact.language.hint.call",
};

/** "Oct 3" / "3 oct": the day the language was set, in the account's zone. */
function shortDay(at: string, zone: string, locale: Tr["locale"]): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(at));
}

/**
 * The Details line (§8.2). Not set names English whatever the account's language: in PR 1 nothing
 * sends in Spanish, so English is the only true fallback today. The account's-language wording
 * arrives in PR 2 with the switch that makes it true (spec §8.2, §15.2).
 */
export function languageView(c: ContactLanguageFacts, opts: { zone: string; tr: Tr }): LanguageView {
  const { tr } = opts;
  if (c.language === null || c.language_source === null || c.language_set_at === null) {
    return { value: null, valueLabel: null, phrase: tr.text("contact.language.notSet", { language: tr.text(NAME_KEY.en) }), hint: null };
  }
  const hint = languageHint(c);
  return {
    value: c.language,
    valueLabel: LANGUAGE_ENDONYM[c.language],
    phrase: tr.text(FROM_KEY[c.language_source], { date: shortDay(c.language_set_at, opts.zone, tr.locale) }),
    hint: hint ? { language: hint.language, text: tr.text(HINT_KEY[hint.source], { language: tr.text(NAME_KEY[hint.language]) }) } : null,
  };
}

const isLang = (v: unknown): v is ContactLanguage => v === "en" || v === "es";

/** The drawer's body is checked, not cast (S-03 part 3 §7.4's rule). */
export function parseLanguageView(v: unknown): LanguageView | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (!(r.value === null || isLang(r.value))) return null;
  if (!(r.valueLabel === null || typeof r.valueLabel === "string") || typeof r.phrase !== "string") return null;
  let hint: LanguageView["hint"] = null;
  if (r.hint !== null) {
    if (typeof r.hint !== "object" || r.hint === null) return null;
    const h = r.hint as Record<string, unknown>;
    if (!isLang(h.language) || typeof h.text !== "string") return null;
    hint = { language: h.language, text: h.text };
  }
  return { value: r.value as ContactLanguage | null, valueLabel: r.valueLabel as string | null, phrase: r.phrase, hint };
}
