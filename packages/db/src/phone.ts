import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * F-009: every typed or spoken number becomes E.164 HERE, and nowhere else
 * (consent chain spec §4.1 item 1, choice 30). It replaces apps/web's
 * `toE164`, which turned ANY ten digits into `+1`, so a Reynosa or Matamoros
 * number a caller spoke was stored as a US number and texted as one.
 *
 * The rules, in order:
 *   1. A number that carries a country code is kept as given: `+…`, or the
 *      international prefixes `011` (dialled from the US) and `00` (from
 *      Mexico). `+52 1 …` (the retired Mexican mobile `1`) drops the `1`.
 *   2. Eleven digits starting with `1` is the NANP trunk prefix a person
 *      types: `+1…`, kept as given.
 *   3. Ten digits: valid ONLY under +1 (the NANP plan: the US, Canada,
 *      Puerto Rico, the Caribbean) → `+1`; valid ONLY under +52 → `+52`;
 *      valid under both, or under neither → `+1` (today's reading, so the
 *      stored `phone_key` does not move) AND `unconfirmed`, so the send gate
 *      holds it until a person picks the country (decision 3).
 *   4. Mexico's retired trunk prefixes: `01` + ten digits, `044`/`045` + ten
 *      digits → `+52` and the ten, when they are a valid Mexican number
 *      (review R1-M1).
 *   5. Any other 8–15 digits not starting with 0 → `+` and the digits, as
 *      `toE164` did. A leading 0 is never a country code, so it is refused.
 *   6. Anything else → null: nothing we can text.
 *
 * Validity comes from libphonenumber-js's MAX metadata. The default MIN
 * metadata validates by LENGTH only, so every ten digits is "valid" as a
 * Mexican number and every US number would read as ambiguous (measured
 * 2026-09-26 on libphonenumber-js 1.13.14: 956-292-1696 is MX-valid under
 * min and MX-invalid under max).
 *
 * Numbers that arrive from the CARRIER (an inbound caller, an inbound
 * sender) already carry `+`, so rule 1 keeps them and they are never
 * `unconfirmed`.
 */
export type PhoneCountry = "US" | "MX";

export type NormalisedPhone = {
  /** E.164, e.g. "+19565550100". */
  e164: string;
  /** True only for a bare ten-digit number valid under both +1 and +52, or under neither. */
  unconfirmed: boolean;
};

const CODE: Record<PhoneCountry, string> = { US: "1", MX: "52" };

function digitsOf(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** `+521XXXXXXXXXX` → `+52XXXXXXXXXX`. Mexico retired the mobile `1` in 2019. */
function dropRetiredMexicanOne(e164: string): string {
  return /^\+521\d{10}$/.test(e164) ? `+52${e164.slice(4)}` : e164;
}

function international(digits: string): NormalisedPhone | null {
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return { e164: dropRetiredMexicanOne(`+${digits}`), unconfirmed: false };
}

function validUnder(tenDigits: string, country: PhoneCountry): boolean {
  return parsePhoneNumberFromString(tenDigits, country)?.isValid() === true;
}

export function normalisePhone(raw: string | null | undefined): NormalisedPhone | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const digits = digitsOf(text);
  if (text.startsWith("+")) return international(digits);
  if (digits.startsWith("011")) return international(digits.slice(3));
  if (digits.startsWith("00")) return international(digits.slice(2));
  if (digits.length === 11 && digits.startsWith("1")) return { e164: `+${digits}`, unconfirmed: false };
  if (digits.length === 10) {
    const us = validUnder(digits, "US");
    const mx = validUnder(digits, "MX");
    if (mx && !us) return { e164: `+52${digits}`, unconfirmed: false };
    return { e164: `+1${digits}`, unconfirmed: us === mx };
  }
  const trunk = /^(?:01|044|045)(\d{10})$/.exec(digits);
  if (trunk) return validUnder(trunk[1]!, "MX") ? { e164: `+52${trunk[1]}`, unconfirmed: false } : null;
  if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")) {
    return { e164: dropRetiredMexicanOne(`+${digits}`), unconfirmed: false };
  }
  return null;
}

/**
 * The ten national digits of a number that is (or was read as) +1 or +52:
 * `+1XXXXXXXXXX`, `1XXXXXXXXXX`, `+52XXXXXXXXXX`, `+521XXXXXXXXXX`, or bare
 * ten digits, with or without separators. Null for anything else.
 */
function nationalTen(raw: string): string | null {
  let digits = digitsOf(raw);
  if (digits.startsWith("011")) digits = digits.slice(3);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("52")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("521")) return digits.slice(3);
  return null;
}

/**
 * A number TYPED beside a country control (the alert phone, spec §6).
 * Only BARE ten digits take the chosen country. Anything carrying a country
 * code (`+`, `00`, `011`, or digits that begin with one: eleven starting
 * `1`, twelve starting `52`, thirteen starting `521`) must name the chosen
 * country, or the answer is null: "52 55 1234 5678" under "US (+1)" is a
 * contradiction to show the person, never a New Jersey number to text a code
 * to (review R3-I1).
 */
export function phoneForCountry(raw: string | null | undefined, country: PhoneCountry): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const digits = digitsOf(text);
  const explicit = text.startsWith("+") ? digits
    : digits.startsWith("011") ? digits.slice(3)
    : digits.startsWith("00") ? digits.slice(2)
    : (digits.length === 11 && digits.startsWith("1"))
      || (digits.length === 12 && digits.startsWith("52"))
      || (digits.length === 13 && digits.startsWith("521")) ? digits
    : null;
  if (explicit !== null) {
    const e164 = international(explicit)?.e164 ?? null;
    if (e164 === null || !e164.startsWith(`+${CODE[country]}`)) return null;
    return nationalTen(e164) === null ? null : e164;
  }
  return digits.length === 10 ? `+${CODE[country]}${digits}` : null;
}

/**
 * The contact drawer's "Mexico (+52)" / "US (+1)" (spec §6, F-009): the
 * stored number's ten national digits, re-read under the country a person
 * chose. A flagged number is always one of these shapes (the flag is only
 * ever set on a ten-digit reading), so null means the stored phone changed
 * under the drawer, and the pick must be refused, not guessed.
 */
export function repickPhoneCountry(stored: string | null | undefined, country: PhoneCountry): string | null {
  const national = nationalTen(String(stored ?? ""));
  return national === null ? null : `+${CODE[country]}${national}`;
}

/**
 * The 0054 backfill's test (spec §4.1 item 1: "flag every stored `+1` number
 * that is also a valid Mexican number"). A number stored WITH its +1 (or as
 * `1` and ten digits) is flagged when its ten digits are valid under +52:
 * the old `toE164` turned any ten digits into +1, so a Reynosa number spoken
 * to Sofía or typed into a form could be sitting here as a US one. A bare
 * ten-digit number is flagged exactly when a write today would flag it
 * (`normalisePhone(...).unconfirmed`); a bare number valid only under +52 is
 * not, because the gate already reads it as +52. Everything else: false.
 * Whether the account has SEEN the number inbound is the SQL's half.
 */
export function couldBeMexican(stored: string | null | undefined): boolean {
  const text = String(stored ?? "").trim();
  const digits = digitsOf(text);
  const plusOne = digits.length === 11 && digits.startsWith("1");
  if (text.startsWith("+") || plusOne) return plusOne && validUnder(digits.slice(1), "MX");
  return digits.length === 10 && normalisePhone(text)?.unconfirmed === true;
}
