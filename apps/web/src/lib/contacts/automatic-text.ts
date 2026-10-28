/** A phone's own auto-reply is not the customer getting in touch (contact archive, review I7): a robocaller's number
 *  that answers our text-back with "I'm driving" must not bring the junk record back. CLOSED lists: a phrase is
 *  added only with a real example (automatic-text.test.ts holds one per phrase). Phrases are written already
 *  normalised (see `norm`): "auto-reply" is "auto reply" here, because the hyphen becomes a space.
 *
 *  Two lists (final review I2). A phone's own status reply OPENS with its phrase ("I'm driving with Driving
 *  Focus…", "Out of office until…"), so those phrases count only at the start: a real reply that mentions one
 *  ("Sorry I missed you, I'm driving. Can we book Tuesday?") is the customer, and brings the contact back. */
const STATUS_PHRASES = [
  "i'm driving", "im driving", "i am driving", "driving right now", "do not disturb while driving",
  "auto reply", "autoreply", "automatic reply", "this is an automated message", "out of office",
  "estoy manejando", "estoy conduciendo", "respuesta automatica", "mensaje automatico", "fuera de la oficina",
] as const;
/** A carrier's or a gateway's wording, which no customer writes about themselves: it counts anywhere. */
const CARRIER_PHRASES = [
  "this number cannot receive", "this number can't receive", "this number does not accept", "cannot receive text messages",
  "no puede recibir mensajes", "este numero no recibe",
] as const;

/** Lower case, accents off, curly quotes straight, and every run of characters that is not a letter, digit or
 *  apostrophe turned into ONE space ("auto-reply" -> "auto reply"), padded, so a phrase matches only on WORD
 *  boundaries: "Send him driving directions" must not match "im driving". */
const norm = (s: string) => ` ${s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[‘’`]/g, "'")
  .replace(/[^a-z0-9']+/g, " ").trim()} `;
const STATUS = [...new Set(STATUS_PHRASES.map(norm))];
const CARRIER = [...new Set(CARRIER_PHRASES.map(norm))];

export function looksAutomaticText(body: string): boolean {
  const b = norm(body);
  // `norm` pads with a leading space, so startsWith keeps the word boundary at the front too.
  return STATUS.some((p) => b.startsWith(p)) || CARRIER.some((p) => b.includes(p));
}
