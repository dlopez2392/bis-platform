// Mirrors branding/theme-mode.ts's resolveThemeMode shape on purpose: a
// precedence chain over values that may be null. `userLanguage` is the
// person's own `users.language` (0066), read once per request by
// `getPersonPrefs` (lib/preferences/person-prefs.ts) and passed by every
// requestLocale call site (pinned in request-locale-callers.test.ts).
export type Locale = "en" | "es";

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "es";
}

export function resolveLocale(
  userLanguage: Locale | null | undefined,
  accountLanguage: Locale | null | undefined,
): Locale {
  if (isLocale(userLanguage)) return userLanguage;
  if (isLocale(accountLanguage)) return accountLanguage;
  return "en";
}
