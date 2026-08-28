// Which language the CALLER actually spoke, for the calls.language column
// and the Calls page badge. Heuristic word-marker scoring over caller turns
// only — the assistant may greet bilingually, which says nothing about the
// caller. Deliberately coarse: this labels a row, it never routes anything.
import type { TranscriptEvent } from "@bis/db";

const ES_MARKERS = /(?:^|[^a-záéíóúñü])(hola|gracias|buenos|buenas|cita|necesito|quiero|por favor|mañana|día|días|tardes|noches|sí|señor|señora|hablar|ayuda|servicio|cuánto|cuando|dónde|está|tiene|para|pero|porque|también|usted)(?=$|[^a-záéíóúñü])/g;
const EN_MARKERS = /(?:^|[^a-z])(the|and|please|appointment|thanks|thank|hello|hi|yes|need|want|tomorrow|morning|afternoon|help|service|how|much|when|where|have|for|but|because|also|you)(?=$|[^a-z])/g;
const ES_CHARS = /[áéíóúñü¿¡]/g;

function score(text: string, re: RegExp): number {
  return (text.toLowerCase().match(re) ?? []).length;
}

export function detectSpokenLanguage(
  transcript: TranscriptEvent[], profileLanguages: "en" | "es" | "both",
): "en" | "es" {
  if (profileLanguages !== "both") return profileLanguages;
  const callerText = transcript.filter((e) => e.role === "caller").map((e) => e.text).join(" ");
  const es = score(callerText, ES_MARKERS) + score(callerText, ES_CHARS);
  const en = score(callerText, EN_MARKERS);
  // ≥2 Spanish hits AND a majority — a lone "gracias" from an English
  // caller must not flip the row. Ties and empties stay "en" (the column's
  // own default, so behavior only ever *improves* on today's).
  return es >= 2 && es > en ? "es" : "en";
}
