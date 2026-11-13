/**
 * `pnpm --filter @bis/db types:gen`    write src/database.types.ts
 * `pnpm --filter @bis/db types:check`  exit 1 if it is stale
 *
 * With no flag, both build a throwaway database in Docker from the bootstrap
 * and every migration (the same Postgres image as CI's stack), generate, and
 * remove it: nothing shared is read. `--db-url-env NAME` generates from the
 * existing database whose URL is in the variable NAME instead; CI's verify-db
 * names SUPABASE_DB_URL, its own stack's. The pieces, and why one generator
 * serves both: ./plan.ts. What it does with the result, and its exit code:
 * ./cli.ts. This file is only the I/O. Needs Docker.
 *
 * Reads no .env file. Production's database is refused (./plan.ts). The URL
 * is never on a command line, and anything docker or postgres-meta prints
 * back (postgres-meta echoes a URL it cannot parse, password and all) is
 * redacted before it is shown (./plan.ts redactSecrets).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli";
import {
  POSTGRES_IMAGE,
  acceptGenerated,
  pgMetaRun,
  redactSecrets,
  schemaFiles,
  type DockerRun,
} from "./plan";

const PKG = fileURLToPath(new URL("../..", import.meta.url));

function docker(args: string[], opts: { env?: Record<string, string>; input?: string } = {}): string {
  const r = spawnSync("docker", args, {
    env: { ...process.env, ...opts.env },
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`types: could not run docker (${r.error.message}). Is Docker installed and running?`);
  if (r.status !== 0) {
    throw new Error(`types: \`docker ${args.slice(0, 2).join(" ")} …\` exited ${r.status}: ${redactSecrets(r.stderr || r.stdout).slice(-1500)}`);
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

runCli(process.argv.slice(2), process.env, {
  generateFrom: (dbUrl) => generate(pgMetaRun(dbUrl, { platform: process.platform })),
  generateFromMigrations,
  readText: (path) => readFileSync(path, "utf8"),
  writeText: (path, text) => writeFileSync(path, text),
  // Drift only: the copy is what the message points the author at. A passing check leaves nothing in the temp dir.
  saveGeneratedCopy: (text) => {
    const copy = join(mkdtempSync(join(tmpdir(), "bis-types-")), "database.types.ts");
    writeFileSync(copy, text);
    return copy;
  },
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}, process);
