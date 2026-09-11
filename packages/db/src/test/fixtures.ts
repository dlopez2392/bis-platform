import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { createAccount } from "../accounts";
import { deleteAccountCascade } from "../account-teardown";

/** Creates a throwaway account, runs fn, then deletes everything it owns (FK order).
 *
 *  The FK order itself lives in `../account-teardown`, shared with the demo
 *  tenant's re-seed, which needs the identical list for the identical reason.
 *  It was inlined here until there was a second caller. */
export async function withTestAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>) {
  const db = serviceDb();
  const orgId = `org_test_${Math.random().toString(36).slice(2, 10)}`;
  const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Fixture Co", actorId: "user_test" });
  try {
    await fn(db, id);
  } finally {
    await deleteAccountCascade(db, id, "withTestAccount");
  }
}
