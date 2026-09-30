/**
 * `pnpm --filter @bis/db ci:sql <file.sql> [--allow-write]`
 *
 * Runs ONE SQL file on the CI project named by `BIS_CI_SUPABASE_REF`
 * (expected `odnobiodsftffphuuosz`) through `pg`, with `SUPABASE_DB_URL` from
 * the env / `packages/db/.env`. See ./sql.ts for why this exists and for the
 * rules; in short:
 *
 *   ci:sql supabase/parity/fingerprint.sql                    read, rolled back
 *   ci:sql supabase/bootstrap/ci-project.sql --allow-write    write, committed
 *
 * Prints the target (never the password) before it connects, then every
 * result set as tab-separated text with a header row, so two runs can be
 * diffed as plain files.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, type QueryResult } from "pg";
import { ciSqlClientConfig, planCiSql, runSqlFile, sqlRefusals } from "./sql";

function printResult(r: QueryResult): void {
  if (!r.fields || r.fields.length === 0) {
    console.log(`-- ${r.command ?? "ok"}${r.rowCount === null ? "" : ` ${r.rowCount}`}`);
    return;
  }
  const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/[\t\n\r]/g, " ");
  console.log(r.fields.map((f) => f.name).join("\t"));
  for (const row of r.rows as Record<string, unknown>[]) {
    console.log(r.fields.map((f) => cell(row[f.name])).join("\t"));
  }
}

async function main(): Promise<void> {
  const packageDir = fileURLToPath(new URL("../..", import.meta.url));
  const plan = planCiSql(process.env, process.argv.slice(2), { cwd: process.cwd(), packageDir });

  console.error(plan.summary);
  console.error("");

  const sql = readFileSync(plan.file, "utf8");
  const refusals = sqlRefusals(sql, { allowWrite: plan.allowWrite });
  if (refusals.length > 0) {
    throw new Error(
      `${plan.allowWrite ? "" : "this file is not read-only (pass --allow-write only if it is meant to write):\n"}` +
      refusals.map((r) => `  ${r}`).join("\n"),
    );
  }

  // Strips PG* (and the CLI overrides) from process.env — where pg reads its
  // fallbacks — then builds an explicit config: every field, TLS included, no
  // connection string for pg to re-read (./sql.ts ciSqlClientConfig).
  const client = new Client(ciSqlClientConfig(process.env));
  await client.connect();
  try {
    const results = await runSqlFile(client, sql, { allowWrite: plan.allowWrite });
    for (const r of results as QueryResult[]) printResult(r);
    console.error(plan.allowWrite ? "\ncommitted" : "\nread only; rolled back");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`\nci:sql refused or failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
