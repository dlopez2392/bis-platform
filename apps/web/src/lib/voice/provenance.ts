import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * DESIGN.md's author mark for anything the receptionist wrote ("Sofía · AI",
 * Provenance): the account's own persona when the screen has it to hand
 * (D-063's rule for the presence indicator, since clients rename theirs),
 * else "Sofía". One function so every surface that marks her work — the call
 * card, the callback To do on the queue and on the contact's timeline —
 * spells the mark the same way. `locale` defaults to English, so a caller
 * that passes none (the agency's work queue, the call card) is unchanged;
 * t()'s interpolation inserts the name literally, never as a `$&` pattern.
 */
export function aiAuthorMark(personaName?: string | null, locale: Locale = "en"): string {
  const name = personaName?.trim() || "Sofía";
  return t(m, "provenance.ai", locale, { name });
}
