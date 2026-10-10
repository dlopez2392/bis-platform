// Mirrors branding/theme-mode.ts's resolveThemeMode shape on purpose: a
// precedence chain over values that may not exist yet. `userLanguage` is
// the seam for the parallel staff-and-roles lane's `users.language text
// null check (language in ('en','es'))` (spec §5) — every caller in THIS
// lane passes undefined for it; the day that column exists, its reader
// starts passing the real value and this function does not change.
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
