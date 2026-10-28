/** A phone's own auto-reply is not the customer getting in touch (contact archive, review I7): a robocaller's number
 *  that answers our text-back with "I'm driving" must not bring the junk record back. A CLOSED list: a phrase is
 *  added only with a real example (automatic-text.test.ts holds one per phrase). A real reply that happens to
 *  contain a listed phrase is still a match, by design: a missed restore costs one click, while a junk record back
 *  on the list costs the owner's trust. Phrases are written already normalised (see `norm`): "auto-reply" is
 *  "auto reply" here, because the hyphen becomes a space. */
const PHRASES = [
  "i'm driving", "im driving", "i am driving", "driving right now", "do not disturb while driving",
  "this number cannot receive", "this number can't receive", "this number does not accept", "cannot receive text messages",
  "auto reply", "autoreply", "automatic reply", "this is an automated message", "out of office",
  "estoy manejando", "estoy conduciendo", "respuesta automatica", "mensaje automatico", "no puede recibir mensajes",
  "este numero no recibe", "fuera de la oficina",
] as const;

/** Lower case, accents off, curly quotes straight, and every run of characters that is not a letter, digit or
 *  apostrophe turned into ONE space ("auto-reply" -> "auto reply"), padded, so a phrase matches only on WORD
 *  boundaries: "Send him driving directions" must not match "im driving". */
const norm = (s: string) => ` ${s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[‘’`]/g, "'")
  .replace(/[^a-z0-9']+/g, " ").trim()} `;
const NORMED = [...new Set(PHRASES.map(norm))];

export function looksAutomaticText(body: string): boolean {
  const b = norm(body);
  return NORMED.some((p) => b.includes(p));
}
