import "dotenv/config";
import { serviceDb } from "../service";
import { sweepAbandonedFixtures } from "./sweep-fixtures";
import { refuseProduction } from "./refuse-production";

/**
 * Runs once before the db suite: first refuses production, then clears
 * fixture accounts that earlier runs were killed before they could remove.
 * See `sweep-fixtures.ts` for why the `finally` in `withTestAccount` is not
 * enough on its own.
 *
 * The refusal comes first and does not depend on credentials being complete.
 * CI runs this suite on its own Supabase project, behind
 * .github/scripts/ci-target-guard.sh; a local run reads packages/db/.env, and
 * where that file still names production (docs/runbooks/ci-supabase-project.md,
 * section 9) the sweep and every test after it would write there. The DB URL
 * alone is enough for `withRollback` to connect, so it is checked even when
 * the API credentials are missing. See ./refuse-production.ts.
 *
 * Before the suite rather than after it, deliberately: an "after" hook is
 * exactly what a killed process skips, so it would share the failure mode it
 * exists to repair. Running first also means a leak is repaired by the very
 * next run rather than waiting for someone to notice.
 */
export default async function setup(): Promise<void> {
  refuseProduction(process.env, "The db suite");

  // The suite itself reports missing credentials, per test, far more clearly
  // than a global setup can. Failing here would only replace that with one
  // confusing error before a single test is collected.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[sweep] no Supabase credentials; skipping abandoned-fixture sweep");
    return;
  }

  const swept = await sweepAbandonedFixtures(serviceDb());
  // Say so when it does something. A sweep that tidies up silently gives no
  // signal that runs are being killed, which is worth knowing about.
  if (swept.length > 0) {
    console.log(
      `[sweep] removed ${swept.length} fixture account(s) abandoned by an earlier run: ` +
      swept.map((a) => `${a.name} (${a.id})`).join(", "),
    );
  }
}
