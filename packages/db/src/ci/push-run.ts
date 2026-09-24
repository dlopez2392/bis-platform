/**
 * `pnpm --filter @bis/db db:push:ci [--dry-run]`  -> supabase db push
 * `pnpm --filter @bis/db db:migrations:ci`        -> supabase migration list
 *
 * Writes ONLY the CI project named by `BIS_CI_SUPABASE_REF` (expected
 * `odnobiodsftffphuuosz`, the `bis-ci` project); production's ref is refused
 * whatever the env says (./target.ts). Production's migrations are applied by
 * the orchestrator through the Supabase MCP, never through this.
 *
 * Reads `packages/db/.env` (dotenv, cwd = this package under pnpm --filter),
 * which the old `db:push` never did — its plans had to export the variable by
 * hand, and a missing one failed silently.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planCiCli, type CiCliMode } from "./push";

/**
 * The CLI's JS entry, run with this same node. Spawning `supabase` by name
 * needs a shell on Windows (`supabase.CMD`), and a shell would re-parse the DB
 * URL argument; running the entry file directly passes it through untouched
 * on every platform.
 */
function supabaseCliEntry(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("supabase/package.json");
  const bin = (JSON.parse(readFileSync(pkgJson, "utf8")) as { bin: { supabase: string } }).bin.supabase;
  return join(dirname(pkgJson), bin);
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== "push" && mode !== "list") {
    throw new Error(`push-run: first argument must be "push" or "list", got "${mode ?? ""}"`);
  }
  const workdir = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
  const plan = planCiCli(mode as CiCliMode, process.env, process.argv.slice(3), { workdir });

  // Out loud, before anything connects: which project, which host, as whom.
  console.log(plan.summary);
  console.log("");

  // `plan.env`, not the inherited environment: no PG* variable for either of
  // the CLI's parsers to fall back on, and no SUPABASE_CLI_BINARY_OVERRIDE
  // for the shim to execute instead of the real CLI (./push.ts).
  const result = spawnSync(process.execPath, [supabaseCliEntry(), ...plan.args], {
    cwd: workdir, stdio: "inherit", env: plan.env,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (e) {
  console.error(`\nrefused: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
