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

/**
 * A blueprint name unique to this process. Use it for EVERY blueprint a test
 * captures; never a bare string literal.
 *
 * `blueprints` is AGENCY-scoped (migration 0007: no `account_id` column, and
 * `unique (agency_id, name)`), so `withTestAccount` — which isolates by
 * ACCOUNT — gives blueprint rows no isolation at all. A hard-coded blueprint
 * name is therefore a mutable singleton shared by every run against this
 * Supabase project, and this suite shares ONE project with production.
 *
 * Two concurrent runs capturing "Starter" do not get a row each. The second
 * finds the first's row and takes the UPDATE branch of `captureBlueprint`,
 * bumping `version` — so `expect(version).toBe(1)` fails with whatever number
 * the other runs happened to reach. Three concurrent CI runs turned that
 * assertion into the genuinely baffling "expected 3 to be 1".
 *
 * It also closes a leak that outlives the run. `deleteAccountCascade` deletes
 * blueprints by `source_account_id`, but the losing run's capture has already
 * reassigned that column to its OWN account — so the row survives its
 * creator's teardown, and every later run of that name finds it, takes the
 * same UPDATE branch and can never see version 1 again. One crashed run would
 * poison the name permanently.
 *
 * `apps/web/e2e/blueprints.spec.ts` already stamps its names for exactly this
 * reason, and says so in a comment written after it cost real time three
 * times. This is that same rule, for the db package.
 */
const BLUEPRINT_RUN = Math.random().toString(36).slice(2, 10);

export const testBlueprintName = (label: string): string => `${label} ${BLUEPRINT_RUN}`;
