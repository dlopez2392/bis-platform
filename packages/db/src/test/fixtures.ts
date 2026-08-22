import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { createAccount } from "../accounts";

/** Creates a throwaway account, runs fn, then deletes everything it owns (FK order). */
export async function withTestAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>) {
  const db = serviceDb();
  const orgId = `org_test_${Math.random().toString(36).slice(2, 10)}`;
  const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Fixture Co", actorId: "user_test" });
  try {
    await fn(db, id);
  } finally {
    // `bookings` then `calendars` come FIRST: migration 0017 made
    // bookings.account_id/calendar_id/contact_id and calendars.account_id all
    // `on delete restrict`, so cleanup order is load-bearing now, not
    // cosmetic — deleting contacts or the account first would fail with a
    // foreign-key violation instead of a passing teardown.
    //
    // Every delete below checks `.error` and throws (the M1c lesson: a
    // swallowed delete error leaves rows behind, and the next test's unique
    // constraints then fail somewhere else entirely, far from the real cause).
    for (const table of ["bookings", "calendars", "events", "form_submissions", "forms",
                         "messages", "conversations",
                         "checklist_items", "contact_tags", "notes", "tasks",
                         "opportunities", "pipeline_stages", "pipelines", "custom_fields",
                         "custom_values", "tags", "contacts"]) {
      const { error } = await db.from(table).delete().eq("account_id", id);
      if (error) throw new Error(`withTestAccount cleanup failed on ${table}: ${error.message}`);
    }
    // `blueprints` has no account_id — it is agency-scoped — so it cannot ride
    // the account-scoped loop above.
    const { error: blueprintsErr } = await db.from("blueprints").delete().eq("source_account_id", id);
    if (blueprintsErr) {
      throw new Error(`withTestAccount cleanup failed on blueprints: ${blueprintsErr.message}`);
    }
    const { error: acctErr } = await db.from("accounts").delete().eq("id", id);
    if (acctErr) throw new Error(`withTestAccount cleanup failed on accounts: ${acctErr.message}`);
  }
}
