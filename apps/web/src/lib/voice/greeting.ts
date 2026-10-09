// The first thing a caller hears — one place, so the phone route and anything
// else that greets cannot pick a different rule.
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

/**
 * The opening line, as words (`text`) and as the `response.create`
 * instruction the call socket sends after the greeting delay (`instruction`).
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
 */
export function openingGreeting(
  profile: GreetingProfile, businessName: string,
): { text: string; instruction: string } {
  if (profile.languages === "both") {
    const en = englishGreeting(profile, businessName);
    const es = spanishGreeting(profile, businessName);
    return {
      text: `${en} ${es}`,
      instruction:
        "Greet the caller with these two greetings, word for word, one right after the other: "
        + "first the English one, then the Spanish one. Do not translate, shorten or combine them. "
        // JSON-quoted (review minor 4): a greeting with its own quotation
        // marks cannot blur where it ends and the next label begins.
        + `English: ${JSON.stringify(en)} Spanish: ${JSON.stringify(es)}`,
    };
  }
  const text = profile.languages === "es"
    ? spanishGreeting(profile, businessName)
    : englishGreeting(profile, businessName);
  return { text, instruction: `Greet the caller with exactly: ${text}` };
}
