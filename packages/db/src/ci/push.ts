/**
 * Plans the Supabase CLI call behind `db:push:ci` and `db:migrations:ci`.
 *
 * These replace `db:push`, which ran `supabase db push --db-url
 * "$SUPABASE_DB_URL"` against whatever that variable held — production, on
 * every machine that had ever run the db suite. What changed is not the CLI
 * call but who is allowed to aim it: the target has to pass `assertCiTarget`
 * first, and the argument list is closed, so nothing typed after the script
 * name can re-aim it (a second `--db-url`, `--linked`) or widen it
 * (`--include-all`, which applies files the remote history does not know
 * about — exactly the drift the parity check exists to surface, not paper
 * over).
 *
 * Pure. ./push-run.ts loads dotenv, prints `summary`, and spawns the CLI with
 * `args`. `args` carries the password inside the DB URL, so it is handed to
 * the child process and never printed; `summary` is what gets printed.
 */
import { assertCiTarget, describeCiTarget, nameArgument, type CiTarget } from "./target";

export type CiCliMode = "push" | "list";

/** The only flags each mode passes through. Anything else is refused. */
const ALLOWED_FLAGS: Record<CiCliMode, readonly string[]> = {
  push: ["--dry-run"],
  list: [],
};

export function planCiCli(
  mode: CiCliMode,
  env: Record<string, string | undefined>,
  argv: readonly string[],
  paths: { workdir: string },
): { target: CiTarget; args: string[]; dryRun: boolean; summary: string } {
  const target = assertCiTarget({
    ref: env.BIS_CI_SUPABASE_REF,
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    dbUrl: env.SUPABASE_DB_URL,
  });

  for (const arg of argv) {
    if (!ALLOWED_FLAGS[mode].includes(arg)) {
      throw new Error(
        `refusing ${nameArgument(arg)}: ${mode === "push" ? "db:push:ci takes only --dry-run" : "db:migrations:ci takes no arguments"}`,
      );
    }
  }
  const dryRun = argv.includes("--dry-run");

  // Read again from env rather than rebuilt from `target`: `target` holds no
  // password by design, and the CLI needs the URL exactly as the operator
  // wrote it (percent-encoding and all — the CLI's own help insists on it).
  const dbUrl = env.SUPABASE_DB_URL!.trim();
  const args = mode === "push"
    ? ["db", "push", "--db-url", dbUrl, "--workdir", paths.workdir, "--yes", ...(dryRun ? ["--dry-run"] : [])]
    : ["migration", "list", "--db-url", dbUrl, "--workdir", paths.workdir];

  const what = mode === "push"
    ? (dryRun ? "supabase db push (dry run: lists what would apply, applies nothing)" : "supabase db push")
    : "supabase migration list";
  const summary = `${what}\n${describeCiTarget(target)}\n  migrations from ${paths.workdir}/supabase/migrations`;

  return { target, args, dryRun, summary };
}
