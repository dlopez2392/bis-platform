import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { createAccount } from "../accounts";
import { deleteAccountCascade } from "../account-teardown";

/**
 * One token per test PROCESS, generated when this module is evaluated.
 *
 * `withTestAccount` below gives every test a fresh ACCOUNT, and that is all it
 * can give: there is exactly one `agencies` row on this project and every
 * account hangs off it (`createAccount` reads `agencies` with `.limit(1)`), so
 * a unique key that does not include `account_id` is a namespace shared by
 * every run of this suite that is alive anywhere at that moment. The one that
 * exists today is `blueprints_agency_id_name_key` — UNIQUE (agency_id, name).
 *
 * `pid` for readability when a row does leak, `Math.random()` because two
 * runners can hold the same pid.
 */
export const TEST_RUN_ID =
  `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * A fixture name that is unique ACROSS concurrent runs and stable WITHIN one.
 *
 * Use it for anything written into a namespace that `withTestAccount` cannot
 * scope — today that means `blueprints.name`, the one agency-global unique key
 * the db suite writes to.
 *
 * Both halves are load-bearing, which is why neither a constant nor a
 * per-call random would do:
 *
 *   unique across runs — a fixed literal is a global lock on that name. Two
 *     suites running at once (two agents in one checkout; two CI `verify`
 *     jobs, whose concurrency group is per-ref so two branches DO overlap)
 *     race on one blueprint row. One loses `captureBlueprint`'s
 *     check-then-insert and fails with `duplicate key value violates unique
 *     constraint "blueprints_agency_id_name_key"`; both then read the other's
 *     version bumps out of the row each believes is its own.
 *
 *   stable within one run — "recapturing the same name replaces the bundle and
 *     bumps version" has to be able to name the same blueprint twice.
 *
 * Precedent, and the reason this is a helper rather than a `Date.now()`
 * sprinkled at each call site: `apps/web/e2e/blueprints.spec.ts` already
 * stamps its blueprint name per run, for this exact failure, in a comment
 * that records it breaking unrelated tests. The db suite never got the same
 * treatment.
 */
export function fixtureName(base: string): string {
  return `${base} ${TEST_RUN_ID}`;
}

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
