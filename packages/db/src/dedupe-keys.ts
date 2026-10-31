/**
 * F-006 part 1 (migration 0106): the TypeScript twins of the database's comparison keys, and the pair
 * reasons' order. IMPORT-FREE on purpose: apps/web's client components import it as `@bis/db/dedupe-keys`.
 * Each function is spelled to match its SQL twin character for character, never with a built-in that
 * folds a superset (the 0034 lesson): no .trim(), no .toLowerCase(), no .normalize(). contact-dedupe-schema.test.ts
 * compares the two sides shape by shape on a real database.
 */

/** phoneDigits' fold (contacts.ts:188-191), restated so this module imports nothing. */
function digitsKey(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/[^0-9]/g, "");
  const k = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return k === "" ? null : k;
}
const TEN = /^[0-9]{10}$/;
const MX = [/^521[0-9]{10}$/, /^04[45][0-9]{10}$/, /^52[0-9]{10}$/, /^01[0-9]{10}$/];

/** app.phone_national: the ten national digits of any +1 or +52 shape (legacy 521, 044, 045 and 01 too), else the digits key. */
export function phoneNational(phone: string | null | undefined): string | null {
  const k = digitsKey(phone);
  if (k === null) return null;
  if (TEN.test(k)) return k;
  return MX.some((re) => re.test(k)) ? k.slice(-10) : k;
}

export type PhoneFamily = "us" | "mx";
/** app.phone_family: "us" for ten digits (a bare ten reads as +1, as phone_key always has), "mx" for every +52 shape, else null. */
export function phoneFamily(phone: string | null | undefined): PhoneFamily | null {
  const k = digitsKey(phone);
  if (k === null) return null;
  if (TEN.test(k)) return "us";
  return MX.some((re) => re.test(k)) ? "mx" : null;
}

/** The fold table, in app.contact_name_fold's order: A-Z, then - . , ', then six whitespace characters, then the
 *  24 upper and 24 lower accented letters of Spanish and Portuguese names. Code points, not a regex class. */
const ACCENT_CODES = [192, 193, 194, 195, 196, 199, 200, 201, 202, 203, 204, 205, 206, 207, 209, 210, 211, 212, 213, 214, 217, 218, 219, 220];
const ACCENT_TO = "aaaaaceeeeiiiinooooouuuu";
const FOLD: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (let c = 65; c <= 90; c++) m.set(String.fromCharCode(c), String.fromCharCode(c + 32));
  for (const s of ["-", ".", ",", "'"]) m.set(s, " ");
  for (const c of [9, 10, 11, 12, 13, 160]) m.set(String.fromCharCode(c), " ");
  ACCENT_CODES.forEach((c, i) => {
    m.set(String.fromCharCode(c), ACCENT_TO[i]!);
    m.set(String.fromCharCode(c + 32), ACCENT_TO[i]!);
  });
  return m;
})();

/** app.contact_name_fold: map, drop everything outside [a-z0-9 ], collapse spaces, trim spaces. */
export function nameFold(value: string | null | undefined): string {
  let out = "";
  for (const ch of value ?? "") out += FOLD.get(ch) ?? ch;
  return out.replace(/[^a-z0-9 ]/g, "").replace(/ +/g, " ").replace(/^ | $/g, "");
}

const KEEP = /^[a-z0-9 ]$/;
/** One character of app.contact_name_fold (0106): the FOLD table's answer if it is in [a-z0-9 ], else "". Called per
 *  code point; nameFold equals these, joined, with runs of spaces collapsed and the ends trimmed (dedupe-keys.test.ts). */
export function foldChar(ch: string): string {
  const f = FOLD.get(ch) ?? ch;
  return KEEP.test(f) ? f : "";
}

/** app.contact_search_name (0108): the non-empty folds of first, last and business name, joined by one space; null
 *  when all three fold to nothing. contact-search-schema.test.ts compares it with the SQL shape by shape. */
export function contactSearchName(
  first: string | null | undefined, last: string | null | undefined, company: string | null | undefined,
): string | null {
  const v = [nameFold(first), nameFold(last), nameFold(company)].filter((p) => p !== "").join(" ");
  return v === "" ? null : v;
}

/** Placeholder first names Sofía and imports write (finish-call.ts:423,435; the archive spec's "Unknown Caller"). */
const PLACEHOLDERS: ReadonlySet<string> = new Set(["caller", "unknown", "desconocido", "cliente", "customer", "na", "none", "sin nombre"]);
/** The first surname: leading particles kept attached, then the next word (app.contact_name_key's regex). */
const SURNAME = /^(((de|del|la|las|los|y|san|santa) )*[a-z0-9]+)/;

/** app.contact_name_key: "first|first surname", or null with no last name or a placeholder first name. */
export function nameKey(first: string | null | undefined, last: string | null | undefined): string | null {
  const f = nameFold(first);
  if (f === "" || PLACEHOLDERS.has(f)) return null;
  const s = SURNAME.exec(nameFold(last))?.[1] ?? "";
  return s === "" ? null : `${f}|${s}`;
}

/** contact_duplicate_flags.strength (0106's generated column): lower is stronger; same_name is last. */
export const DUPLICATE_REASON_STRENGTH: Readonly<Record<string, number>> = {
  same_phone: 1, same_email: 2, email_phone_conflict: 3, same_digits: 4, phone_country_twin: 4,
  phone_shared_new_person: 5, hidden_match: 6, phone_match_on_edit: 7, email_match_on_edit: 7,
  phone_country_pick: 7, same_name: 9,
};
export function reasonStrength(reason: string): number {
  return DUPLICATE_REASON_STRENGTH[reason] ?? 8;
}

export type ReasonLabel = "samePhone" | "sameDigits" | "sameEmail" | "sameName" | "other";
const LABEL: Readonly<Record<string, ReasonLabel>> = {
  same_phone: "samePhone", phone_shared_new_person: "samePhone", phone_match_on_edit: "samePhone", phone_country_pick: "samePhone",
  same_digits: "sameDigits", phone_country_twin: "sameDigits",
  same_email: "sameEmail", email_match_on_edit: "sameEmail",
  same_name: "sameName",
};
/** The words a pair is shown with (contacts.duplicates.reason.*). */
export function reasonLabel(reason: string): ReasonLabel {
  return LABEL[reason] ?? "other";
}

/** Owner ruling D7: a merge can be undone for 30 days. 0106's contact_merges_window check pins the same number. */
export const MERGE_UNDO_DAYS = 30;
