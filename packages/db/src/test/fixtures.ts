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
    for (const table of ["events", "form_submissions", "forms", "messages", "conversations",
                         "contact_tags", "notes", "tasks",
                         "opportunities", "pipeline_stages", "pipelines", "custom_fields",
                         "custom_values", "tags", "contacts"]) {
      await db.from(table).delete().eq("account_id", id);
    }
    await db.from("accounts").delete().eq("id", id);
  }
}
