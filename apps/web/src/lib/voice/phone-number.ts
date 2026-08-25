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
