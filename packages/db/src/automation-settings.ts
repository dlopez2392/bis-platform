import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What is left of the automation settings module. The per-account quiet
 * hours it used to read and save (automation_settings, 0046) are retired:
 * the sending hours are FIXED (consent chain spec decision 4,
 * apps/web/src/lib/consent/hours.ts), and nothing reads the table any more
 * (source scan 5). The table and its columns stay until a later migration
 * drops them once both databases pass the parity check.
 */

/** The inline instant reply has no due-row to carry the zone; it reads it here, once, after a send is decided. */
export async function readAccountTimezone(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`readAccountTimezone failed: ${error.message}`);
  return (data as { timezone: string | null } | null)?.timezone ?? null;
}
