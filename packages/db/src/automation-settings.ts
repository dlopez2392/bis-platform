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

/**
 * D-061: `accounts.outbound_suppressed` (0032) is true for a demo or
 * pre-go-live account nothing should ever contact. Every scheduled pass
 * honours it for free through `loadSendableRows` (booking.ts) — every
 * `listDue*` filters on it before a row is even returned. The inline
 * instant reply has no due-list to filter it through (it fires straight
 * from a form submission), so it reads the flag itself, here, the same way
 * it reads the account's zone just above. A missing account reads as not
 * suppressed, the same posture `loadAccountBrandInfo` takes before this
 * column existed (DEFAULT FALSE, byte-identical for every account already
 * on file) — the account itself is a data problem the recipe's own `getAutomation`
 * read would have already surfaced.
 */
export async function isAccountOutboundSuppressed(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await db.from("accounts").select("outbound_suppressed").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`isAccountOutboundSuppressed failed: ${error.message}`);
  return (data as { outbound_suppressed: boolean | null } | null)?.outbound_suppressed === true;
}
