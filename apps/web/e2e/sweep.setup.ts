import { test as sweep } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { sweepStaleFixtures, formatSweepReport } from "./fixtures/sweep";

// Same two paths, same reason, as auth.setup.ts: this file talks to Supabase
// and Clerk from the Playwright runner process, not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The human entry point: `pnpm --filter web e2e:sweep`.
 *
 * Its own Playwright project, deliberately NOT a dependency of anything — it
 * reuses the runner's TypeScript and env loading rather than adding a script
 * runner to the workspace for one file.
 *
 * **Report-only unless `E2E_SWEEP_DELETE=1`.** It deletes from the database
 * that also holds `Test Client One` and from the Clerk instance that holds
 * danlo's own identity, so seeing the list first is the default and asking for
 * the deletions is a deliberate act. `auth.setup.ts` passes `dryRun: false`
 * directly, because a suite about to create a fixture is the one caller that
 * has already decided.
 */
sweep("sweep abandoned e2e fixtures", async () => {
  const dryRun = process.env.E2E_SWEEP_DELETE !== "1";
  const report = await sweepStaleFixtures({ dryRun });
  console.log(formatSweepReport(report, dryRun));
  if (dryRun) {
    console.log("\n  (report only — re-run with E2E_SWEEP_DELETE=1 to delete)");
  }
  // Errors are reported, not thrown: a sweep that cleared three of four things
  // did more good than one that aborted on the first rate limit.
  if (report.errors.length > 0) {
    console.error(`\n  ${report.errors.length} step(s) failed — see above`);
  }
});
