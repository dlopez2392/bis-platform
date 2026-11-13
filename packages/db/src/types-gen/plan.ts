/**
 * The generated database types (src/database.types.ts): how they are made,
 * and how CI tells a stale copy from a current one. ./run.ts does the I/O.
 *
 * ONE GENERATOR, TWO CALLERS. `types:gen` (a developer, after writing a
 * migration) and `types:check` (CI's verify-db, on its own stack) both run
 * pgMetaRun's command, so for the same schema they print the same bytes; any
 * other pairing (the CLI's `gen types` in one place, a script in the other)
 * would differ in formatting and leave the check red forever.
 *
 * The generator is Supabase's own: postgres-meta's `dist/server/server.js`
 * with PG_META_GENERATE_TYPES set prints a types file and exits. That is
 * exactly what `supabase gen types typescript` runs, in the same image
 * (CLI 2.109.1, the version CI pins, uses postgres-meta v0.96.6:
 * apps/cli-go/pkg/config/templates/Dockerfile at tag v2.109.1) with the same
 * settings (apps/cli-go/internal/gen/types/types.go), except the schema list.
 */
import { mentionsProduction, PRODUCTION_SUPABASE_REF } from "../ci/target";

/** postgres-meta at the version Supabase CLI 2.109.1 runs, pinned by digest (read 2026-11-13). */
export const PG_META_IMAGE =
  "public.ecr.aws/supabase/postgres-meta:v0.96.6@sha256:a84cc713585eea7b401e4a2561ec4a1e48c87083d1c7ecb4502f204bb4391300";

/**
 * The database CLI 2.109.1's stack runs (config.toml major_version 17), for
 * the throwaway database `types:gen` builds when given no URL.
 */
export const POSTGRES_IMAGE =
  "public.ecr.aws/supabase/postgres:17.6.1.143@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";

/**
 * The two schemas the migrations build. Not the CLI's default (`public` plus
 * config.toml's api.schemas, i.e. graphql_public): graphql_public belongs to
 * the platform, not to this repo, and nothing here calls it. `app` holds the
 * RLS helpers and is not exposed through the Data API: its types document
 * the SQL, no client can reach them.
 */
export const INCLUDED_SCHEMAS = "public,app";

/** Where the types live, from the repository root. */
export const TYPES_FILE = "packages/db/src/database.types.ts";

/** The one command that regenerates them. */
export const REGENERATE = "pnpm --filter @bis/db types:gen";

export type DockerRun = {
  /** `docker` arguments. Every PG_META_* value travels in `env`, by name only here. */
  args: string[];
  env: Record<string, string>;
};

/**
 * Where the generator's container finds the database: a named docker network
 * (the throwaway database's), or the machine's own. On Linux the container
 * shares the host's network; Docker Desktop (Windows, macOS) cannot, so a
 * loopback host there becomes host.docker.internal.
 */
export type Reach = { network: string } | { platform: NodeJS.Platform };

export function pgMetaRun(dbUrl: string, reach: Reach): DockerRun {
  if (mentionsProduction(dbUrl)) {
    throw new Error(
      `types: refusing production's database (${PRODUCTION_SUPABASE_REF}). Generate from the migrations instead: ${REGENERATE}`,
    );
  }
  let url = dbUrl;
  const network: string[] = [];
  if ("network" in reach) {
    network.push("--network", reach.network);
  } else if (reach.platform === "linux") {
    network.push("--network", "host");
  } else {
    url = dbUrl.replace(/@(127\.0\.0\.1|localhost)([:/]|$)/, "@host.docker.internal$2");
  }
  const env = {
    PG_META_DB_URL: url,
    PG_META_GENERATE_TYPES: "typescript",
    PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS: INCLUDED_SCHEMAS,
    PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS: "true",
  };
  return {
    args: ["run", "--rm", ...network, ...Object.keys(env).flatMap((name) => ["-e", name]), PG_META_IMAGE, "node", "dist/server/server.js"],
    env,
  };
}

/**
 * The generator's stdout, if it is a types file. postgres-meta prints its
 * errors to the same stream, so an unreachable database must never become
 * the checked-in file.
 */
export function acceptGenerated(stdout: string): string {
  if (!stdout.startsWith("export type Json =") || !stdout.includes("\nexport type Database = {")) {
    throw new Error(`types: postgres-meta did not print a types file. It printed: ${stdout.slice(0, 300) || "(nothing)"}`);
  }
  return stdout;
}

/** null when `checkedIn` is byte for byte `generated`; otherwise what to tell the author. */
export function driftReport(checkedIn: string, generated: string): string | null {
  if (checkedIn === generated) return null;
  const a = checkedIn.split("\n");
  const b = generated.split("\n");
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line++;
  const quote = (s: string | undefined) => (s === undefined ? "(end of file)" : `\`${s}\``);
  return (
    `${TYPES_FILE} is not what the migrations generate (first difference at line ${line + 1}; ` +
    `checked in: ${quote(a[line])}, generated:  ${quote(b[line])}). ` +
    `Run \`${REGENERATE}\` (Docker must be running) and commit the result.`
  );
}

export type Args = { mode: "write" | "check"; dbUrl: string | null };

const USAGE = "usage: run.ts write|check [--db-url-env <NAME of a variable holding a postgres URL>]";

/**
 * `--db-url-env NAME`, never the URL itself: pnpm prints a failed script's
 * whole command line, and a URL carries a password.
 */
export function parseArgs(argv: string[], env: Record<string, string | undefined>): Args {
  const [mode, ...rest] = argv;
  if (mode !== "write" && mode !== "check") throw new Error(USAGE);
  if (rest.length === 0) return { mode, dbUrl: null };
  if (rest.length !== 2 || rest[0] !== "--db-url-env" || !rest[1]) throw new Error(USAGE);
  const dbUrl = env[rest[1]];
  if (!dbUrl) throw new Error(`types: ${rest[1]} is empty or unset, so there is no database to generate from.`);
  return { mode, dbUrl };
}

/**
 * The SQL that builds the throwaway database, relative to packages/db, in the
 * CI stack's order (.github/scripts/ci-local-supabase.sh): the bootstrap,
 * then every migration by file name, as `supabase db push` applies them.
 */
export function schemaFiles(migrationDir: string[]): string[] {
  return [
    "supabase/bootstrap/ci-project.sql",
    ...migrationDir.filter((f) => f.endsWith(".sql")).sort().map((f) => `supabase/migrations/${f}`),
  ];
}
