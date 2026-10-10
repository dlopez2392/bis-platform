import {
  savePersonPreference, isPersonTheme, isPersonLanguageValue,
  type PersonLanguage, type PersonTheme, type PersonProfile, type SupabaseClient,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";

/**
 * The save core for a person's own preferences (F-096, spec §7).
 *
 * Deps are injected so the two server actions (actions.ts) are the only
 * callers that reach a real `userId`/`db`/Clerk profile; this module never
 * reads `auth()` itself, so the forged-caller risk lives entirely in the
 * action, not here. `field` picks which closed list `raw` is checked
 * against before `savePersonPreference` is ever called — an invalid value
 * never reaches the database (spec §7: "an unlisted value is refused with
 * no query").
 */

export type PrefsError = "prefs.invalid" | "prefs.failed";
export type PrefsResult<T> = { ok: true; previous: T | null } | { ok: false; error: PrefsError };

export function parseLanguage(raw: unknown): { ok: true; value: PersonLanguage | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (isPersonLanguageValue(raw)) return { ok: true, value: raw };
  return { ok: false };
}

export function parseTheme(raw: unknown): { ok: true; value: PersonTheme | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (isPersonTheme(raw)) return { ok: true, value: raw };
  return { ok: false };
}

export async function saveMyPreferenceWith<F extends "language" | "theme">(
  deps: { userId: string; db: () => SupabaseClient; profile: () => Promise<PersonProfile | null> },
  field: F, raw: unknown,
): Promise<PrefsResult<F extends "language" ? PersonLanguage : PersonTheme>> {
  type V = F extends "language" ? PersonLanguage : PersonTheme;
  const parsed = field === "language" ? parseLanguage(raw) : parseTheme(raw);
  if (!parsed.ok) return { ok: false, error: "prefs.invalid" };

  try {
    const write = field === "language"
      ? { field: "language" as const, value: parsed.value as PersonLanguage | null }
      : { field: "theme" as const, value: parsed.value as PersonTheme | null };
    const r = await savePersonPreference(deps.db(), deps.userId, write, deps.profile);
    if (r.outcome === "no_profile") return { ok: false, error: "prefs.failed" };
    return { ok: true, previous: (r.previous ?? null) as V | null };
  } catch (e) {
    console.error(`preferences: save failed for field ${field}: ${loggableError(e)}`);
    return { ok: false, error: "prefs.failed" };
  }
}
