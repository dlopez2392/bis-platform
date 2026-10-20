// The first thing a PHONE caller hears: the incoming route's opening line,
// decided here and nowhere else. (The system prompt embeds no greeting; the
// website chat shows its own per-language greeting on its page.)
import type { VoiceProfileRow } from "@bis/db";

type GreetingProfile = Pick<VoiceProfileRow, "languages" | "greeting_en" | "greeting_es">;

/** The operator's own greeting, or — when it is blank — the fallback in THAT
 *  language, naming the brand (never the agency's internal label). */
function englishGreeting(profile: GreetingProfile, businessName: string): string {
  return profile.greeting_en?.trim() || `Thanks for calling ${businessName}. How can I help you today?`;
}
function spanishGreeting(profile: GreetingProfile, businessName: string): string {
  return profile.greeting_es?.trim() || `Gracias por llamar a ${businessName}. ¿En qué le puedo ayudar?`;
}

/** What a caller hears after the greeting when this call discloses (spec D3, owner 2026-10-20). Speech,
 *  not UI: constants here, pinned word for word in both languages by greeting.test.ts. */
function aiSentence(lang: "en" | "es", persona: string): string {
  return lang === "es"
    ? `Soy ${persona}, una asistente de inteligencia artificial. Esta llamada se transcribe para que el equipo le dé seguimiento.`
    : `I'm ${persona}, an AI assistant. This call is transcribed so the team can follow up.`;
}

/** Whether THIS call says it, decided per call by the incoming route (`decideDisclosure`). */
export type GreetingDisclosure = { disclose: boolean; personaName: string };

/**
 * The opening line: the `response.create` instruction the call socket sends
 * after the greeting delay.
 *
 * - `en` / `es`: that language's greeting, trimmed, in the instruction the
 *   route has always sent ("Greet the caller with exactly: …"). Trimmed is
 *   not byte-identical to before: the route used to send a non-blank
 *   greeting untrimmed.
 * - `both` (D-037, owner decision 2026-10-08, Option A): the English greeting,
 *   then the Spanish one, each the operator's own words (trimmed of leading
 *   and trailing whitespace, otherwise unchanged). Before this a bilingual line's
 *   Spanish greeting was never heard. The instruction is deliberately short
 *   and literal: the Realtime model must say the operator's own words, not
 *   translate one into the other or blend them into a single sentence. A
 *   caller can interrupt either half (turn detection), and from then on the
 *   prompt's LANGUAGE line has her answer in whatever language they use.
 *
 * A blank half falls back in its own language rather than being dropped: a
 * `both` profile saved before Setup required both greetings can still have one.
 *
 * S-47a (decision 20): when `disclosure.disclose` is true, the D3 sentence
 * ("I'm {persona}, an AI assistant. …" / "Soy {persona}, …") follows EACH
 * greeting in that greeting's language, inside the same word-for-word
 * instruction: on a bilingual line, English greeting + English sentence, then
 * Spanish greeting + Spanish sentence. A blank persona falls back to Sofía, as
 * the prompt's IDENTITY line does. When false, the instruction is
 * byte-identical to before S-47a.
 */
export function openingGreeting(
  profile: GreetingProfile, businessName: string, disclosure: GreetingDisclosure,
): { instruction: string } {
  const persona = disclosure.personaName.trim() || "Sofía";
  // Off: the greeting alone, so the instruction is byte-identical to before S-47a.
  const said = (greeting: string, lang: "en" | "es") =>
    disclosure.disclose ? `${greeting} ${aiSentence(lang, persona)}` : greeting;
  if (profile.languages === "both") {
    const en = said(englishGreeting(profile, businessName), "en");
    const es = said(spanishGreeting(profile, businessName), "es");
    return {
      instruction:
        "Greet the caller with these two greetings, word for word, one right after the other: "
        + "first the English one, then the Spanish one. Do not translate, shorten or combine them. "
        // JSON-quoted (review minor 4): a greeting with its own quotation
        // marks cannot blur where it ends and the next label begins.
        + `English: ${JSON.stringify(en)} Spanish: ${JSON.stringify(es)}`,
    };
  }
  const text = profile.languages === "es"
    ? said(spanishGreeting(profile, businessName), "es")
    : said(englishGreeting(profile, businessName), "en");
  return { instruction: `Greet the caller with exactly: ${text}` };
}
