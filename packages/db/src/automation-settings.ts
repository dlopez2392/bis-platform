import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

/** The quiet-hours window as the app speaks it: "HH:MM" on the account's wall clock. */
export type QuietSettings = { enabled: boolean; start: string; end: string };

export const DEFAULT_QUIET_SETTINGS: QuietSettings = { enabled: true, start: "21:00", end: "08:00" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isClock(v: string): boolean {
  return HHMM.test(v);
}

/** Postgres renders `time` as "21:00:00"; the app carries "21:00". */
function toClock(pgTime: string): string {
  return pgTime.slice(0, 5);
}

/** Missing row = the defaults, WITHOUT writing one. */
export async function readQuietSettings(db: SupabaseClient, accountId: string): Promise<QuietSettings> {
  const { data, error } = await db.from("automation_settings")
    .select("quiet_enabled, quiet_start, quiet_end").eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`readQuietSettings failed: ${error.message}`);
  if (!data) return DEFAULT_QUIET_SETTINGS;
  const r = data as { quiet_enabled: boolean; quiet_start: string; quiet_end: string };
  return { enabled: r.quiet_enabled, start: toClock(r.quiet_start), end: toClock(r.quiet_end) };
}

/** serviceDb()-only by grant; the caller checks isAgency (0025's rule). */
export async function saveQuietSettings(
  db: SupabaseClient, accountId: string, s: QuietSettings, actorId: string, actorType: ActorType = "user",
): Promise<void> {
  if (!isClock(s.start) || !isClock(s.end)) throw new Error("saveQuietSettings: times must be HH:MM");
  const { error } = await db.from("automation_settings").upsert({
    account_id: accountId, quiet_enabled: s.enabled, quiet_start: s.start, quiet_end: s.end,
    updated_at: new Date().toISOString(),
  }, { onConflict: "account_id" });
  if (error) throw new Error(`saveQuietSettings failed: ${error.message}`);
  await emit(db, accountId, "automation_settings.updated", actorId, { quiet: s }, actorType);
}

/** The inline instant reply has no due-row to carry the zone; it reads it here, once, after a send is decided. */
export async function readAccountTimezone(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`readAccountTimezone failed: ${error.message}`);
  return (data as { timezone: string | null } | null)?.timezone ?? null;
}
