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
// The rule: every greeting the profile's language setting uses (English for
// `en`, Spanish for `es`, BOTH for `both`), plus the facts the assistant
// answers from. `both` needs both because of the owner's decision that a
// bilingual PHONE line opens in English and then in Spanish, so a blank
// Spanish greeting is half of every call's opening. (Not because of the
// website: the snippet never sets `?locale=es`, so the chat opens on
// `greeting_en` unless a direct link asks for Spanish.)
//
// The greeting is named before the facts when both are missing, so the
// operator is pointed at the first field on the form. A bilingual profile
// with English written and only Spanish blank is its own gap,
// `spanish_greeting`, so the operator is told which box is empty rather than
// "write the greeting" about one they already wrote.
//
// Pure and import-free (the type import is erased) so a "use client"
// component can import it through the `@bis/db/profile-ready` subpath without
// pulling the database client into the browser bundle.
import type { VoiceProfileRow } from "./voice";

export type AssistantProfileFields =
  Pick<VoiceProfileRow, "greeting_en" | "greeting_es" | "facts" | "languages">;

export type AssistantProfileGap = "greeting" | "spanish_greeting" | "facts";

function blank(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** Which piece is missing, or null when the profile is ready. */
export function assistantProfileGap(profile: AssistantProfileFields): AssistantProfileGap | null {
  const needsEn = profile.languages !== "es";
  const needsEs = profile.languages !== "en";
  const enMissing = needsEn && blank(profile.greeting_en);
  const esMissing = needsEs && blank(profile.greeting_es);
  if (profile.languages === "both" && esMissing && !enMissing) return "spanish_greeting";
  if (enMissing || esMissing) return "greeting";
  if (blank(profile.facts)) return "facts";
  return null;
}

/** No profile row at all is not ready, the same as a blank one. */
export function isAssistantProfileReady(profile: AssistantProfileFields | null): boolean {
  return profile !== null && assistantProfileGap(profile) === null;
}
