// S-47e: the constants and the value-printing rule shared by the TeXML
// form-field observation log (`…/texml/telnyx-request.ts`'s `logFormFields`)
// and the SIP-leg attestation log (`@/lib/voice/sip-headers`'s
// `sipAttestation`), so the two can never drift on what counts as an
// attestation-looking field name or on what is safe to print.
export const FIELD_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
export const ATTESTATION_FIELD = /attest|shaken|stir|verstat/i;
export const SAFE_VALUE = /^[A-Za-z0-9 _.:-]{0,64}$/;
export const MAX_ATTESTATION = 10;

/**
 * A value safe to put in a log line: unprintable (any character outside the
 * safe set, or past 64 characters) hides it entirely; a long run of digits —
 * a phone number — is redacted; otherwise it prints verbatim.
 */
export function shownValue(value: string): string {
  return !SAFE_VALUE.test(value) ? "(unprintable)" : /\d{7,}/.test(value) ? "(redacted)" : value;
}
