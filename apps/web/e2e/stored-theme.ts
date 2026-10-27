import { readFileSync } from "node:fs";
import { serviceDb } from "@bis/db";

/**
 * A person's SAVED theme (`users.theme`, migration 0067), read and cleared
 * for one per-run identity.
 *
 * Why the theme specs need this (CI e2e on 2c0e6fb0, feat/mis-preferencias).
 * Since mis preferencias (D5), the topbar toggle saves the mode it picks to
 * `users.theme` as well as the `bis-theme` cookie, and a saved theme outranks
 * the cookie, the tenant's brand_mode and the role default. A spec that clicks
 * the toggle therefore leaves a real saved choice behind on the shared
 * per-run identity, and a later test that is about the NO-saved-choice path
 * then gets the saved choice instead. Two did: theme.spec's "sidebar stays
 * dark in light mode" set a `light` cookie under the agency's saved `dark`
 * from the toggle test above it, and tenant-theme.spec's cookie-less
 * dark-default test ran under the client's saved `light` from its own toggle
 * test. Each paint was exactly the last toggled value.
 *
 * Keyed on clerk_user_id, through the service client, and touching only the
 * `theme` column of the one row named (the pattern preferences.spec's own
 * afterAll uses). Both identities are minted per run by auth.setup.ts and
 * deleted by teardown, so this never reaches a real person's row.
 */

export const AGENCY_FIXTURE_FILE = "e2e/.auth/agency-fixture.json";
export const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/** The Clerk user id auth.setup.ts recorded in a fixture file. Throws if absent. */
export function fixtureClerkUserId(file: string): string {
  const { clerkUserId } = JSON.parse(readFileSync(file, "utf-8")) as { clerkUserId?: string };
  if (!clerkUserId) throw new Error(`${file} carries no clerkUserId — the "setup" project did not run.`);
  return clerkUserId;
}

/** The identity's saved theme, or null for "no choice". Throws on a read error or a missing row. */
export async function storedTheme(clerkUserId: string): Promise<string | null> {
  const { data, error } = await serviceDb()
    .from("users").select("theme").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`users.theme read failed: ${error.message}`);
  if (!data) throw new Error(`no users row for the fixture identity — has it signed in yet?`);
  return (data as { theme: string | null }).theme;
}

/** Back to "no choice" (NULL), the state every theme spec's no-saved-choice test is about. */
export async function clearStoredTheme(clerkUserId: string): Promise<void> {
  const { error } = await serviceDb()
    .from("users").update({ theme: null }).eq("clerk_user_id", clerkUserId);
  if (error) throw new Error(`users.theme clear failed: ${error.message}`);
}

/**
 * Puts back exactly the saved theme a spec read before it clicked the toggle
 * (null = no choice). For a spec that is NOT about theming but clicks the
 * toggle for another reason, so it hands the identity on as it found it.
 * stored-theme-guard.test.ts requires this or clearStoredTheme in any spec
 * that clicks the toggle.
 */
export async function restoreStoredTheme(clerkUserId: string, theme: string | null): Promise<void> {
  const { error } = await serviceDb()
    .from("users").update({ theme }).eq("clerk_user_id", clerkUserId);
  if (error) throw new Error(`users.theme restore failed: ${error.message}`);
}
