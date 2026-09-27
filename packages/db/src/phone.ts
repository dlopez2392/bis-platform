import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * F-009: every typed or spoken number becomes E.164 HERE, and nowhere else
 * (consent chain spec §4.1 item 1, choice 30). It replaces apps/web's
 * `toE164`, which turned ANY ten digits into `+1`, so a Reynosa or Matamoros
 * number a caller spoke was stored as a US number and texted as one.
 *
 * A trailing extension ("x2", "ext. 12", "#4"), any case, is stripped before
 * anything below reads the string — including the `+` branch (review I1):
 * an extension's digits are never part of the number.
 *
 * The rules, in order:
 *   1. A number that carries a country code is kept as given: `+…`, or the
 *      international prefixes `011` (dialled from the US) and `00` (from
 *      Mexico). `+52 1 …` (the retired Mexican mobile `1`) drops the `1`.
 *   2. Eleven digits starting with `1` is the NANP trunk prefix a person
 *      types: `+1…`, kept as given.
 *   3. Ten digits: a leading 0 is refused outright (review m1 — never a
 *      country code, never a real national number). Otherwise: valid ONLY
 *      under +1 (the NANP plan: the US, Canada, Puerto Rico, the Caribbean)
 *      → `+1`; valid ONLY under +52 → `+52`; valid under both, or under
 *      neither → `+1` (today's reading, so the stored `phone_key` does not
 *      move) AND `unconfirmed`, so the send gate holds it until a person
 *      picks the country (decision 3).
 *   4. Mexico's retired trunk prefixes: `01` + ten digits, `044`/`045` + ten
 *      digits → `+52` and the ten, when they are a valid Mexican number
 *      (review R1-M1).
 *   5. Without a `+`, `00` or `011`, ONLY the other code forms the spec
 *      names: twelve digits starting `52`, thirteen starting `521` → kept
 *      as given. The old rule 5 ("any other 8-15 digits") is NOT in the
 *      spec and is gone (review I1): it read an extension's or a trailing
 *      digit group's digits as part of the number, confirming a US number
 *      with an extension as Swiss, Myanmar or Moroccan.
 *   6. Anything else → null: nothing we can text. The text is then kept as
 *      typed (`phoneFields`), and the gate refuses it as no number.
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

/**
 * A trailing extension ("x2", "ext 12", "ext. 3", "#4"), any case, stripped
 * before anything else reads the string — including the `+` branch (review
 * I1). Without this, "(415) 555-0100 x2" or "(956) 292-1696 ext 12" read
 * their extension digits as PART of the phone number, turning a US number
 * with an extension into a confirmed Swiss or Myanmar one.
 */
function stripExtension(raw: string): string {
  return raw.replace(/[\s,.-]*(?:ext\.?|extension|[x#])[\s.:-]*\d+\.?\s*$/i, "").trim();
}

export function normalisePhone(raw: string | null | undefined): NormalisedPhone | null {
  const text = stripExtension(String(raw ?? "").trim());
  if (!text) return null;
  const digits = digitsOf(text);
  if (text.startsWith("+")) return international(digits);
  if (digits.startsWith("011")) return international(digits.slice(3));
  if (digits.startsWith("00")) return international(digits.slice(2));
  if (digits.length === 11 && digits.startsWith("1")) return { e164: `+${digits}`, unconfirmed: false };
  if (digits.length === 10) {
    // A leading 0 in a bare ten digits is never a country code and never a
    // real NANP/MX national number — refuse it before judging validity
    // (review m1), rather than falling through to "+10…", a number nobody
    // could dial.
    if (digits.startsWith("0")) return null;
    const us = validUnder(digits, "US");
    const mx = validUnder(digits, "MX");
    if (mx && !us) return { e164: `+52${digits}`, unconfirmed: false };
    return { e164: `+1${digits}`, unconfirmed: us === mx };
  }
  const trunk = /^(?:01|044|045)(\d{10})$/.exec(digits);
  if (trunk) return validUnder(trunk[1]!, "MX") ? { e164: `+52${trunk[1]}`, unconfirmed: false } : null;
  // Without a +, 00 or 011, ONLY the code forms the spec names are accepted:
  // twelve digits starting 52, thirteen starting 521 (review I1). The old
  // rule 5 ("any other 8-15 digits") is NOT in the spec, and let an
  // extension or a trailing digit group ("212-555-0100 ext 3", once its
  // digits leaked in) or a stray "after 5" read as a confirmed number in
  // Switzerland, Myanmar or Morocco. Anything else without a prefix returns
  // null: the text is then kept as typed (phoneFields), and the gate
  // refuses it as no number.
  if (digits.length === 12 && digits.startsWith("52")) return international(digits);
  if (digits.length === 13 && digits.startsWith("521")) return international(digits);
  return null;
}

/**
 * The ten national digits of a number that is (or was read as) +1 or +52:
 * `+1XXXXXXXXXX`, `1XXXXXXXXXX`, `+52XXXXXXXXXX`, `+521XXXXXXXXXX`, or bare
 * ten digits, with or without separators. Null for anything else.
 */
function nationalTen(raw: string): string | null {
  const text = raw.trim();
  // A `+` carries an explicit country code, so its remaining digits must be
  // EXACTLY a recognised code + ten national digits — never just "however
  // many digits happen to total ten". Without this, "+52 1234 5678" (an
  // 8-digit number wearing a `+52` as padding) counted its whole 10-digit
  // total as a bare national number and returned "+5212345678" as if it
  // were valid (review m2).
  const hadPrefix = text.startsWith("+");
  let digits = digitsOf(text);
  if (digits.startsWith("011")) digits = digits.slice(3);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && !hadPrefix) return digits;
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
  // Same extension strip as normalisePhone (review I5, the 0054 backfill's
  // gap): without it, "+1 551 234 5613 ext 12"'s digits include the
  // extension's own ("...561312"), landing at 13 digits instead of 11 and
  // always reading as "not a bare +1", so an ambiguous legacy number wearing
  // an extension was never flagged.
  const text = stripExtension(String(stored ?? "").trim());
  const digits = digitsOf(text);
  const plusOne = digits.length === 11 && digits.startsWith("1");
  if (text.startsWith("+") || plusOne) return plusOne && validUnder(digits.slice(1), "MX");
  return digits.length === 10 && normalisePhone(text)?.unconfirmed === true;
}
