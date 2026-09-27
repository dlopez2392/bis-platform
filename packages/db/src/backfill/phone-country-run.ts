/**
 * `pnpm --filter @bis/db backfill:phone-country <candidates-file> --cutoff <ISO> [--emit-sql <out.sql>]`
 *
 * Reads the output of supabase/backfills/0054-phone-country-candidates.sql
 * (execute_sql's JSON, or ci:sql's tab-separated text), keeps the numbers
 * that could be Mexican, and splits them by who wrote them (`byWriter`).
 * `--cutoff` is the new deploy's READY instant plus Skew Protection's
 * maximum age if it is on (the plan's final task). Prints every count, per
 * account, and the ids of the rows it will NOT flag, so none is dropped
 * silently. WRITES NOTHING unless `--emit-sql` names a file, and then it
 * writes that file, never a database. Running the emitted SQL is the
 * orchestrator's step, on production only after danlo has seen the counts.
 * Never prints a phone number.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { byWriter, countByAccount, flagSql, parseCandidates, planBackfillArgs, rowsToFlag } from "./phone-country";

function main(): void {
  const plan = planBackfillArgs(process.argv.slice(2));
  if (!plan.ok) {
    console.error(plan.error);
    process.exit(2);
  }
  const { input, cutoff, out } = plan;
  const candidates = parseCandidates(readFileSync(input, "utf8"));
  const mexican = rowsToFlag(candidates);
  const { flag, writtenAfter, newBuild } = byWriter(mexican, cutoff);
  console.log(`candidates read: ${candidates.length}`);
  console.log(`could be Mexican: ${mexican.length}`);
  console.log(`  to flag (created before ${cutoff.toISOString()}, or stored in a shape the new build never writes): ${flag.length}`);
  for (const [account, n] of countByAccount(flag)) console.log(`    account ${account}: ${n}`);
  console.log(`  of those, last written after the cut-off (flagged anyway: updated_at cannot say who wrote the phone): ${writtenAfter.length}`);
  for (const [account, n] of countByAccount(writtenAfter)) console.log(`    account ${account}: ${n}`);
  console.log(`  NOT flagged, created after the cut-off as E.164 (the new build's own reading): ${newBuild.length}`);
  for (const r of newBuild) console.log(`    contact ${r.id} (account ${r.account_id})`);
  if (!out) {
    console.log("no --emit-sql: nothing written");
    return;
  }
  if (flag.length === 0) {
    console.log("nothing to flag: no SQL written");
    return;
  }
  writeFileSync(out, flagSql(flag));
  console.log(`wrote ${out} (${flag.length} row(s)); it holds ids and keys only, never a phone number`);
}

main();
