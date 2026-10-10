import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRole, PersonLanguage } from "./team";

/**
 * A person's own preferences (F-096, mis preferencias). `users.language`
 * (0066) and `users.theme` (0067) are both NULL = no choice; the caller
 * resolves a default (cookie, brand_mode, role) when this module returns
 * null for a field. Writes are server-only (0066 revoked INSERT/UPDATE on
 * `public.users` from `authenticated`) and always keyed on the caller's own
 * `clerk_user_id` — never a person id taken from the browser.
 */

export type PersonTheme = "light" | "dark" | "system";
export const PERSON_THEMES: readonly PersonTheme[] = ["light", "dark", "system"];
export const PERSON_LANGUAGES: readonly PersonLanguage[] = ["en", "es"];

export type PersonPrefs = { language: PersonLanguage | null; theme: PersonTheme | null };
export const NO_PREFS: PersonPrefs = Object.freeze({ language: null, theme: null });

export function isPersonTheme(v: unknown): v is PersonTheme {
  return typeof v === "string" && (PERSON_THEMES as readonly string[]).includes(v);
}

export function isPersonLanguageValue(v: unknown): v is PersonLanguage {
  return typeof v === "string" && (PERSON_LANGUAGES as readonly string[]).includes(v);
}

/** Narrows whatever the row holds; an unknown value reads as no choice, never throws. */
export function prefsFromRow(row: { language?: unknown; theme?: unknown } | null | undefined): PersonPrefs {
  if (!row) return NO_PREFS;
  return {
    language: isPersonLanguageValue(row.language) ? row.language : null,
    theme: isPersonTheme(row.theme) ? row.theme : null,
  };
}

/** users by clerk_user_id. null = no users row. Throws on a read error. */
export async function readPersonPrefs(db: SupabaseClient, clerkUserId: string): Promise<PersonPrefs | null> {
  const { data, error } = await db.from("users").select("language, theme")
    .eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readPersonPrefs failed: ${error.message}`);
  if (!data) return null;
  return prefsFromRow(data as { language: unknown; theme: unknown });
}

/** ONE read: memberships ⋈ users. null = no membership in this account. Throws on a read error. */
export async function readAccountRoleAndPrefs(
  db: SupabaseClient, accountId: string, clerkUserId: string,
): Promise<{ role: AccountRole; prefs: PersonPrefs } | null> {
  const { data, error } = await db.from("memberships").select("role, users!inner(clerk_user_id, language, theme)")
    .eq("scope", "account").eq("account_id", accountId).eq("users.clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readAccountRoleAndPrefs failed: ${error.message}`);
  if (!data) return null;
  return {
    role: data.role as AccountRole,
    prefs: prefsFromRow(data.users as unknown as { language: unknown; theme: unknown }),
  };
}

export type PreferenceWrite =
  | { field: "language"; value: PersonLanguage | null }
  | { field: "theme"; value: PersonTheme | null };

export type PersonProfile = { email: string; name: string | null };

/**
 * Writes ONE field of the caller's own users row, keyed on clerk_user_id. Creates the row (never a
 * membership) when none exists, asking `profile` for the email it needs. Throws on an unlisted value
 * (callers validate first; this is the second wall) and on a database error.
 */
export async function savePersonPreference(
  db: SupabaseClient, clerkUserId: string, write: PreferenceWrite, profile: () => Promise<PersonProfile | null>,
): Promise<{ outcome: "saved"; previous: PersonLanguage | PersonTheme | null } | { outcome: "no_profile" }> {
  const ok = write.field === "theme"
    ? write.value === null || isPersonTheme(write.value)
    : write.value === null || isPersonLanguageValue(write.value);
  if (!ok) throw new Error(`savePersonPreference: unlisted ${write.field}`);

  const { data: row, error } = await db.from("users").select("id, language, theme")
    .eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`savePersonPreference read failed: ${error.message}`);

  if (row) {
    const previous = prefsFromRow(row as { language: unknown; theme: unknown })[write.field];
    const { error: e2 } = await db.from("users").update({ [write.field]: write.value }).eq("id", row.id as string);
    if (e2) throw new Error(`savePersonPreference update failed: ${e2.message}`);
    return { outcome: "saved", previous };
  }

  const p = await profile();
  if (!p?.email) return { outcome: "no_profile" };
  // Upsert, not insert: two first saves racing (two tabs) both land; ON CONFLICT updates only the sent columns.
  const { error: e3 } = await db.from("users")
    .upsert({ clerk_user_id: clerkUserId, email: p.email, name: p.name, [write.field]: write.value }, { onConflict: "clerk_user_id" });
  if (e3) throw new Error(`savePersonPreference insert failed: ${e3.message}`);
  return { outcome: "saved", previous: null };
}
