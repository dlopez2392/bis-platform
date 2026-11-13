/**
 * `pnpm --filter @bis/db types:gen`    write src/database.types.ts
 * `pnpm --filter @bis/db types:check`  exit 1 if it is stale
 *
 * With no flag, both build a throwaway database in Docker from the bootstrap
 * and every migration (the same Postgres image as CI's stack), generate, and
 * remove it: nothing shared is read. `--db-url-env NAME` generates from the
 * existing database whose URL is in the variable NAME instead; CI's verify-db
 * names SUPABASE_DB_URL, its own stack's. The pieces, and why one generator
 * serves both: ./plan.ts. Needs Docker.
 *
 * Reads no .env file. Production's database is refused (./plan.ts).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POSTGRES_IMAGE,
  TYPES_FILE,
  acceptGenerated,
  driftReport,
  parseArgs,
  pgMetaRun,
  schemaFiles,
  type DockerRun,
} from "./plan";

const PKG = fileURLToPath(new URL("../..", import.meta.url));
const OUT = join(PKG, "src", "database.types.ts");

function docker(args: string[], opts: { env?: Record<string, string>; input?: string } = {}): string {
  const r = spawnSync("docker", args, {
    env: { ...process.env, ...opts.env },
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`types: could not run docker (${r.error.message}). Is Docker installed and running?`);
  if (r.status !== 0) {
    throw new Error(`types: \`docker ${args.slice(0, 2).join(" ")} …\` exited ${r.status}: ${(r.stderr || r.stdout).slice(-1500)}`);
  }
  return r.stdout;
}

function generate(run: DockerRun): string {
  return acceptGenerated(docker(run.args, { env: run.env }));
}

/**
 * Builds the schema the way CI's stack does (bootstrap, then each migration
 * in its own transaction) in a container of CI's Postgres image, on a docker
 * network of its own, and generates from it. Always removes both.
 */
function generateFromMigrations(): string {
  const id = `bis-types-${process.pid}-${Date.now()}`;
  const db = `${id}-db`;
  const psql = (user: string, sql: string) =>
    docker(["exec", "-i", "-e", "PGPASSWORD=postgres", db, "psql", "-X", "-q", "-h", "127.0.0.1", "-U", user,
      "-d", "postgres", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });
  docker(["network", "create", id]);
  try {
    console.log(`types: starting a throwaway database (${POSTGRES_IMAGE.split("@")[0]})`);
    docker(["run", "-d", "--rm", "--name", db, "--network", id, "-e", "POSTGRES_PASSWORD=postgres", POSTGRES_IMAGE]);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const ready = spawnSync("docker", ["exec", db, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres"]);
      if (ready.status === 0) break;
      if (Date.now() > deadline) throw new Error("types: the throwaway database was not ready within 120s");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    // In CI's stack, storage-api creates storage.buckets; this image alone
    // does not. The bootstrap and 0077 each insert one bucket, nothing reads
    // it back, and the storage schema is not in the generated types.
    psql("supabase_admin",
      "create table storage.buckets (id text primary key, name text not null, public boolean default false, " +
      "file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), " +
      "updated_at timestamptz default now()); grant all on storage.buckets to postgres;");
    const files = schemaFiles(readdirSync(join(PKG, "supabase", "migrations")));
    console.log(`types: applying ${files.length} files (the bootstrap and ${files.length - 1} migrations)`);
    for (const f of files) {
      try {
        psql("postgres", readFileSync(join(PKG, f), "utf8"));
      } catch (e) {
        throw new Error(`types: ${f} failed to apply. ${(e as Error).message}`);
      }
    }
    return generate(pgMetaRun(`postgresql://postgres:postgres@${db}:5432/postgres`, { network: id }));
  } finally {
    spawnSync("docker", ["rm", "-f", db]);
    spawnSync("docker", ["network", "rm", id]);
  }
}

function main(): void {
  const { mode, dbUrl } = parseArgs(process.argv.slice(2), process.env);
  const generated = dbUrl ? generate(pgMetaRun(dbUrl, { platform: process.platform })) : generateFromMigrations();
  if (mode === "write") {
    writeFileSync(OUT, generated);
    console.log(`types: wrote ${TYPES_FILE} (${generated.split("\n").length} lines)`);
    return;
  }
  const report = driftReport(readFileSync(OUT, "utf8"), generated);
  if (report === null) {
    console.log(`types: ${TYPES_FILE} matches the schema`);
    return;
  }
  const copy = join(mkdtempSync(join(tmpdir(), "bis-types-")), "database.types.ts");
  writeFileSync(copy, generated);
  console.error(`${process.env.GITHUB_ACTIONS === "true" ? "::error::" : ""}${report} The generated file is at ${copy}.`);
  process.exitCode = 1;
}

try {
  main();
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
