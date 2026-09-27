import { normalisePhone } from "@bis/db/phone";

/**
 * E.164 or nothing, by F-009's one rule (packages/db/src/phone.ts,
 * `normalisePhone`): a number with a country code is kept as given, and ten
 * digits become +1 or +52 by which country's plan they are valid in. It
 * replaced `toE164`, which made ANY ten digits into `+1` — so a Reynosa
 * number a caller spoke was stored as a US one. External APIs accept only
 * E.164 (live-verified 2026-07-26: "9562921696", "(956) 292-1696" and
 * "19562921696" are refused; "+19562921696" passes).
 *
 * A number valid as both a US and a Mexican one comes back as `+1` here;
 * whether its country is CONFIRMED is `normalisePhone`'s `unconfirmed`,
 * which the contact row stores and the send gate reads. Use normalisePhone
 * directly wherever that matters.
 */
export function e164Of(raw: string | null | undefined): string | null {
  return normalisePhone(raw)?.e164 ?? null;
}

/**
 * The number to STORE for a caller, from what the model wrote down (review
 * R2-C1, R1-I4). A contact write must get the number as said, never its
 * E.164: `phoneFields` (packages/db) stores the E.164 AND flags a number
 * that could be Mexican or US, while an E.164 "+1…" reads as confirmed.
 *   - Nothing usable said, or the caller ID repeated (its ten digits, from
 *     a +1 or a +52 caller ID) → the caller ID, which the carrier supplied
 *     and which says its own country.
 *   - Otherwise the words as said, with a leading 1 before ten digits dropped
 *     first. ASSUMPTION (not verified): the model adds +1 to a number the
 *     caller never gave a country for, and that +1 would hide the question.
 * Null when there is nothing to store.
 */
export function spokenPhone(said: string | null | undefined, callerNumber: string | null | undefined): string | null {
  const text = String(said ?? "").trim();
  const caller = callerNumber ?? null;
  const digits = text.replace(/[^0-9]/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
  const callerDigits = (caller ?? "").replace(/[^0-9]/g, "");
  // A Mexican caller ID too (re-review minor 4): a caller reciting their own
  // ten digits is the caller, never a second, +1-flagged contact.
  const callerNational = callerDigits.length === 11 && callerDigits.startsWith("1") ? callerDigits.slice(1)
    : callerDigits.length === 12 && callerDigits.startsWith("52") ? callerDigits.slice(2)
    : callerDigits.length === 13 && callerDigits.startsWith("521") ? callerDigits.slice(3)
    : callerDigits;
  if (!text || !e164Of(national ?? text)) return caller;
  if (caller && (digits === callerDigits || (national ?? digits) === callerNational)) return caller;
  return national ?? text;
}

/**
 * Is a contact's stored phone the number this call came from? Contacts keep a
 * phone in whatever shape it was typed ("(956) 292-1696" from a web form), so
 * it is normalized before the compare. Caller ID is what the carrier presents,
 * not an authentication — but it is the one identity a call carries, and the
 * voice tools act on a contact only when it is this number. A withheld caller
 * ID matches nothing, not even a blank stored phone.
 */
export function isCallerIdNumber(
  stored: string | null | undefined, callerNumber: string | null | undefined,
): boolean {
  return !!callerNumber && e164Of(stored) === callerNumber;
}

/**
 * @deprecated The old name, kept ONLY while Tasks 9, 12 and 13 move its last
 * callers (the passes, the composer, the alert phone). It IS e164Of, so those
 * callers already get F-009's rule. Task 15 deletes it, and its scan keeps it
 * deleted.
 */
export const toE164 = e164Of;
