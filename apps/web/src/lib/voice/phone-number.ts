// E.164 or nothing. Live-verified 2026-07-26 in the reception demo: external
// APIs reject "9562921696", "(956) 292-1696", "956-292-1696", "19562921696";
// only "+19562921696" passes. Every number leaving this app goes through here.
export function toE164(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
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
  return !!callerNumber && toE164(stored) === callerNumber;
}
