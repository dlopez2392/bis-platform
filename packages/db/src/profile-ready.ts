// Is this voice profile ready for the assistant to answer anyone?
//
// ONE question, asked in three places that used to ask it three ways (D-108):
// Setup's "write the greeting and facts" row (`isVoiceProfileDone`,
// apps/web/src/lib/setup/setup-status.ts), the Voice page's website-assistant
// toggle (`conciergeLockReason`, voice-settings.tsx) and the server write that
// switches the assistant on (`enableConcierge`, concierge.ts). Setup wanted
// facts plus the main greeting; the toggle wanted `greeting_en` always (so a
// Spanish-only line could never be switched on, D-051) and never facts; the
// server wanted only a row. The assistant could be on while Setup said To do.
//
// The rule: every greeting the profile's language setting will actually show
// a visitor (English for `en`, Spanish for `es`, BOTH for `both`, because the
// website assistant picks `greeting_es` for a Spanish visitor on a bilingual
// line), plus the facts the assistant answers from. Greeting is named before
// facts when both are missing, so the operator is pointed at the first field
// on the form.
//
// Pure and import-free (the type import is erased) so a "use client"
// component can import it through the `@bis/db/profile-ready` subpath without
// pulling the database client into the browser bundle.
import type { VoiceProfileRow } from "./voice";

export type AssistantProfileFields =
  Pick<VoiceProfileRow, "greeting_en" | "greeting_es" | "facts" | "languages">;

export type AssistantProfileGap = "greeting" | "facts";

function blank(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** Which piece is missing, or null when the profile is ready. */
export function assistantProfileGap(profile: AssistantProfileFields): AssistantProfileGap | null {
  const needsEn = profile.languages !== "es";
  const needsEs = profile.languages !== "en";
  if ((needsEn && blank(profile.greeting_en)) || (needsEs && blank(profile.greeting_es))) {
    return "greeting";
  }
  if (blank(profile.facts)) return "facts";
  return null;
}

/** No profile row at all is not ready, the same as a blank one. */
export function isAssistantProfileReady(profile: AssistantProfileFields | null): boolean {
  return profile !== null && assistantProfileGap(profile) === null;
}
