import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every table owned by one account, in the order they must be deleted.
 *
 * The order is LOAD-BEARING, not cosmetic. Migration 0017 made
 * `bookings.account_id/calendar_id/contact_id` and `calendars.account_id`
 * `on delete restrict`, so deleting contacts or the account before bookings
 * fails with a foreign-key violation. `sites` likewise precedes nothing by
 * accident: its two traffic tables reference it.
 *
 * Extracted from `test/fixtures.ts`, which held the only copy until the demo
 * tenant needed to re-seed itself. A second hand-maintained copy of a
 * 25-entry FK-ordered list is a bug with a delivery date: the table that gets
 * added to one and not the other leaves rows behind, and the failure surfaces
 * somewhere else entirely, on a unique constraint, far from the cause. One
 * list, two callers.
 */
export const ACCOUNT_OWNED_TABLES = [
  "site_traffic_breakdown", "site_traffic_daily", "sites",
  "calls", "bookings", "calendars", "events", "form_submissions", "forms",
  "messages", "conversations",
  "checklist_items", "contact_tags", "notes", "tasks",
  "opportunities", "pipeline_stages", "pipelines", "custom_fields",
  "custom_values", "tags", "contacts",
  "voice_profiles", "phone_numbers", "automations",
] as const;

/**
 * Deletes everything one account owns, then the account row itself.
 *
 * Every delete checks `.error` and throws (the M1c lesson: a swallowed delete
 * error leaves rows behind, and the next caller's unique constraints then fail
 * somewhere else entirely, far from the real cause). `caller` rides the
 * message so a failure says which of the two callers hit it.
 */
export async function deleteAccountCascade(
  db: SupabaseClient, accountId: string, caller: string,
): Promise<void> {
  for (const table of ACCOUNT_OWNED_TABLES) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) throw new Error(`${caller} cleanup failed on ${table}: ${error.message}`);
  }
  // `blueprints` has no account_id — it is agency-scoped — so it cannot ride
  // the account-scoped loop above.
  const { error: blueprintsErr } = await db.from("blueprints")
    .delete().eq("source_account_id", accountId);
  if (blueprintsErr) {
    throw new Error(`${caller} cleanup failed on blueprints: ${blueprintsErr.message}`);
  }
  const { error: acctErr } = await db.from("accounts").delete().eq("id", accountId);
  if (acctErr) throw new Error(`${caller} cleanup failed on accounts: ${acctErr.message}`);
}
