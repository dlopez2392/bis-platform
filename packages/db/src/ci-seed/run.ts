/**
 * `pnpm --filter @bis/db ci:seed`
 *
 * Seeds the CI project (named by `BIS_CI_SUPABASE_REF`, expected
 * `odnobiodsftffphuuosz`) with the account the e2e suite reads, then verifies
 * every row the suites assume and exits non-zero naming whatever is missing.
 * Safe to run on every e2e job: a second run finds everything and writes
 * nothing. Refuses production (../ci/target.ts), before it connects.
 *
 * Writes through the service client (`NEXT_PUBLIC_SUPABASE_URL` +
 * `SUPABASE_SERVICE_ROLE_KEY`), so the guard's URL check is the one that
 * matters here; the DB URL is checked too, because an env file with one half
 * switched to the CI project and the other still on production is exactly
 * the state to stop in.
 */
import "dotenv/config";
import { serviceDb } from "../service";
import { planCiSeed } from "./config";
import { baselineGaps, ensureCiBaseline, readBaselineSnapshot } from "./seed";

async function main(): Promise<void> {
  const plan = planCiSeed(process.env);
  console.log(plan.summary);
  console.log("");

  const db = serviceDb();
  const { accountId, created } = await ensureCiBaseline(db, plan.spec);
  console.log(created.length > 0 ? `  created: ${created.join(", ")}` : "  nothing to create; the baseline was already in place");
  console.log(`  account id ${accountId}`);

  const gaps = baselineGaps(await readBaselineSnapshot(db, plan.spec), plan.spec);
  if (gaps.length > 0) {
    throw new Error(`the CI project is NOT ready for the suites:\n${gaps.map((g) => `  - ${g}`).join("\n")}`);
  }
  console.log("\n  verified: every row the db and e2e suites assume is present");
}

main().catch((e) => {
  console.error(`\nci:seed FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
