import { PERSON_THEMES, type PersonLanguage, type PersonTheme } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The radios on the Preferences page (F-096, spec §6), with no React.
 *
 * "account" is the radio for a stored NULL: a client login with no language
 * of its own follows the account's. The agency has no account to follow
 * (owner decision 1: with no choice the agency stays English), so it is
 * never offered that radio, and its NULL checks nothing at all rather than
 * pretending a choice was made.
 */
export type LanguageChoice = "en" | "es" | "account";

const AGENCY_LANGUAGES: readonly LanguageChoice[] = ["en", "es"];
const CLIENT_LANGUAGES: readonly LanguageChoice[] = ["en", "es", "account"];

export function languageChoicesFor(isAgency: boolean): readonly LanguageChoice[] {
  return isAgency ? AGENCY_LANGUAGES : CLIENT_LANGUAGES;
}

export function languageChoiceFrom(value: PersonLanguage | null, isAgency: boolean): LanguageChoice | null {
  if (value !== null) return value;
  return isAgency ? null : "account";
}

export function languageValueOf(choice: LanguageChoice): PersonLanguage | null {
  return choice === "account" ? null : choice;
}

/** The locale a stored language value is read in: its own, or for NULL the
 *  account's (a client), else English (the agency, or an account with none). */
export function localeOfLanguage(value: PersonLanguage | null, accountLanguage: PersonLanguage | null): Locale {
  return value ?? accountLanguage ?? "en";
}

export const THEME_CHOICES: readonly PersonTheme[] = PERSON_THEMES;

/**
 * What the `bis-theme` cookie should hold after a choice, the one thing the
 * SERVER reads before any client code runs. Never the literal "system"
 * (theme-mode.ts's userThemeSyncPlan: the cookie carries a mode, not a
 * policy), so "system" records the device's answer right now. NULL clears
 * it: an Undo back to "no choice" must land on the login's default, not on
 * whatever mode the undone choice wrote.
 */
export function themeCookieFor(choice: PersonTheme | null, prefersDark: boolean): "light" | "dark" | null {
  if (choice === "light" || choice === "dark") return choice;
  if (choice === "system") return prefersDark ? "dark" : "light";
  return null;
}
