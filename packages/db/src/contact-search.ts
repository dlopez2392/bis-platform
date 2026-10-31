/**
 * F-092 part 1 (spec 4.1, 4.2): how a typed customer search is read. Imports only ./dedupe-keys (itself import-free),
 * so apps/web's client components import it as `@bis/db/contact-search` (the highlight, the empty-state floor).
 */
import { nameFold, phoneNational } from "./dedupe-keys";

export const MAX_SEARCH_LENGTH = 80;          // search-term.ts's MAX_TERM_LENGTH: the same paste cap
export const MAX_NAME_TOKENS = 6;
export const MIN_PHONE_SEARCH_DIGITS = 4;     // owner ruling Q2 (2026-10-31): today's floor
const PHONE_SHAPE = /^[+()\-. \d]+$/;         // contacts.ts:879's PHONE_SEARCH_SHAPE, restated (this file imports nothing else)

export type PhoneSearch = { key: string; national: string | null };
/** `keptKey`: af5976fa's phone_key digits for this term, when the new `phone.key` does not cover them (they do not
 *  contain it), else null. The contact list's filter keeps a clause on it and `phoneMatches` falls back to it, so a
 *  number found before F-092 is still found, and still shown as what matched (spec D4; T4 review, Minor 3). */
export type ContactSearchPlan = { tokens: string[]; phone: PhoneSearch | null; keptKey: string | null };

/** Digits for phone_key (0033: the digits, an 11-digit leading 1 folded off). A leading "+" names a country code:
 *  "+1" drops its 1; "+521" (the legacy Mexican mobile prefix) becomes "52", as phone_key stores a Mexican number. */
function keyDigits(raw: string): string {
  const d = raw.replace(/[^0-9]/g, "");
  const plus = raw.trimStart().startsWith("+");
  if (plus && d.startsWith("521")) return `52${d.slice(3)}`;
  if (plus && d.startsWith("1")) return d.slice(1);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * af5976fa's phone_key digits (contacts.ts's phoneSearchDigits before F-092), frozen: the whole RAW term must be
 * phone-shaped; every digit, an 11-digit leading 1 folded off (phone_key's own fold, 0033), no "+" rule; at least
 * MIN_PHONE_SEARCH_DIGITS, at most 20. The floor is deliberately the SAME constant as the new key's (owner ruling
 * Q2 kept today's 4), and the frozen oracles in contact-search.test.ts and contact-search-filter.test.ts pin 4
 * literally, so moving the constant without moving them fails both.
 */
function af5976faKey(raw: string): string {
  if (!PHONE_SHAPE.test(raw)) return "";
  const d = raw.replace(/[^0-9]/g, "");
  const k = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return k.length >= MIN_PHONE_SEARCH_DIGITS ? k.slice(0, 20) : "";
}

export function contactSearchPlan(raw: string): ContactSearchPlan {
  const term = raw.slice(0, MAX_SEARCH_LENGTH);
  const tokens = nameFold(term).split(" ").filter((t) => t !== "").slice(0, MAX_NAME_TOKENS);
  const today = af5976faKey(raw);
  const kept = (phone: PhoneSearch | null) => (today !== "" && !(phone && today.includes(phone.key)) ? today : null);
  if (!PHONE_SHAPE.test(term)) return { tokens, phone: null, keptKey: kept(null) };
  const key = keyDigits(term).slice(0, 20);
  if (key.length < MIN_PHONE_SEARCH_DIGITS) return { tokens, phone: null, keptKey: kept(null) };
  const n = phoneNational(term.replace(/[^0-9]/g, ""));
  const phone = { key, national: n !== null && n.length === 10 && n !== key ? n : null };
  return { tokens, phone, keptKey: kept(phone) };
}

/** True when `phone` (as stored) is what a phone-shaped search matched. Drives the route's sublabel. */
export function phoneMatches(plan: ContactSearchPlan, phone: string | null | undefined): boolean {
  if ((!plan.phone && !plan.keptKey) || !phone) return false;
  const d = phone.replace(/[^0-9]/g, "");
  const stored = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (plan.keptKey && stored.includes(plan.keptKey)) return true;
  if (!plan.phone) return false;
  if (stored.includes(plan.phone.key)) return true;
  const n = phoneNational(phone);
  return plan.phone.national !== null && n !== null && n.includes(plan.phone.national);
}
