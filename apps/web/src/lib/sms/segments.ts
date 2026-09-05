/**
 * SMS segment counting, encoding-aware.
 *
 * A message fits 160 characters in GSM-7. ANY character outside that set
 * drops the WHOLE message to UCS-2 at 70 characters per segment — and this
 * platform is bilingual by design (greeting_es, ?locale=es, Spanish booking
 * pages), so a Spanish text with the wrong accent or a curly apostrophe
 * silently less-than-halves capacity and doubles the bill. A naive character
 * count would mislead precisely where it matters most, which is why this is
 * a charset check rather than `body.length`.
 *
 * Concatenation costs header space: multi-part GSM-7 is 153 per part and
 * multi-part UCS-2 is 67, not 160/70.
 */
const GSM7_BASE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Each costs TWO septets, because it is sent as an escape plus the char. */
const GSM7_EXTENDED = "^{}\\[~]|€";

export type SmsSegments = {
  encoding: "gsm7" | "ucs2";
  /** Septets for gsm7 (extension chars counted as 2), UTF-16 code units for ucs2. */
  chars: number;
  segments: number;
};

export function segmentsFor(body: string): SmsSegments {
  let septets = 0;
  let gsm7 = true;
  for (const ch of body) {
    if (GSM7_BASE.includes(ch)) { septets += 1; continue; }
    if (GSM7_EXTENDED.includes(ch)) { septets += 2; continue; }
    gsm7 = false;
    break;
  }

  if (gsm7) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "gsm7", chars: septets, segments };
  }

  // UCS-2 counts UTF-16 code units, so an emoji (a surrogate pair) is two.
  const units = body.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "ucs2", chars: units, segments };
}
