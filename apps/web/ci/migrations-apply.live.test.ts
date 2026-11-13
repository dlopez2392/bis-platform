import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .github/scripts/migrations-apply.sh against a REAL Postgres (plan PR 3).
// migrations-apply.test.ts pins what the runner decides from history; these
// prove what applying does: one transaction per file, the history row and its
// content, terse errors, the lock timeout, no retry.
//
// The database: SUPABASE_DB_URL, which in CI's verify-db is the stack inside
// that runner (127.0.0.1:54322). It must be LOOPBACK: each case creates its
// own scratch DATABASE there (never the suite's own) and drops it after, and
// nothing here may ever touch a hosted project. Inside GitHub Actions a
// non-loopback or missing URL is a FAILURE; on a developer's machine, whose
// live suite points at bis-ci, this file is skipped, saying why. Run it
// locally against a throwaway Postgres: SUPABASE_DB_URL=postgresql://postgres@127.0.0.1:<port>/postgres.
// Needs psql on PATH.

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const toBashPath = (p: string) => p.replace(/\\/g, "/");
const SCRIPT = toBashPath(path.join(REPO, ".github/scripts/migrations-apply.sh"));
const DIR = "packages/db/supabase/migrations";
const MARKER = "-- applied by .github/scripts/migrations-apply.sh";
const ADMIN = process.env.SUPABASE_DB_URL ?? "";
const LOOPBACK = /^postgres(ql)?:\/\/[^@/]+@(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/[A-Za-z0-9_]+$/.test(ADMIN);

if (!LOOPBACK && process.env.GITHUB_ACTIONS === "true") {
  throw new Error("migrations-apply.live.test.ts: SUPABASE_DB_URL is missing or not loopback in CI; verify-db's stack should have set it. Refusing to run against anything else.");
}
if (!LOOPBACK) console.warn("migrations-apply.live.test.ts SKIPPED: SUPABASE_DB_URL is not a loopback Postgres (see the file's header).");

vi.setConfig({ testTimeout: 60_000 });

function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  const under = (r: string) => path.join(r, "usr", "bin", "bash.exe");
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter((b): b is string => Boolean(b)).map((b) => path.join(b, "Git"));
  const found = roots.find((r) => fs.existsSync(under(r)));
  if (found) return under(found);
  const r = path.resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "..", "..", "..");
  if (fs.existsSync(under(r))) return under(r);
  throw new Error("No Git for Windows bash found");
}

let bash = "";
let root = "";
const databases: string[] = [];
const holders: ChildProcess[] = [];

const urlFor = (db: string) => ADMIN.replace(/\/[A-Za-z0-9_]+$/, `/${db}`);

/** Runs SQL as psql would print it with -tA; throws on any error. */
function sql(url: string, query: string): string {
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
}

/** A scratch database with the history table the Supabase CLI creates. */
function scratchDatabase(): string {
  const db = `bis_mig_${randomBytes(6).toString("hex")}`;
  sql(ADMIN, `create database ${db}`);
  databases.push(db);
  const url = urlFor(db);
  sql(url, "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);");
  return url;
}

/** A scratch repository tree holding these migration files. */
function tree(contents: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(root, "tree-"));
  fs.mkdirSync(path.join(dir, DIR), { recursive: true });
  for (const [name, text] of Object.entries(contents)) fs.writeFileSync(path.join(dir, DIR, name), text);
  return dir;
}

type Run = { status: number | null; output: string; ms: number };

function apply(cwd: string, target: string, files: string[], env: Record<string, string> = {}, extra: string[] = []): Run {
  const e: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const k of Object.keys(e)) if (k === "GITHUB_ACTIONS") delete e[k];
  const started = Date.now();
  const r = spawnSync(bash, [SCRIPT, "--target", target, ...extra, ...files.map((f) => `${DIR}/${f}`)], { cwd, env: e, encoding: "utf8", timeout: 120_000 });
  if (r.error) throw r.error;
  return { status: r.status, output: `${r.stdout}${r.stderr}`, ms: Date.now() - started };
}

const md5 = (text: string) => createHash("md5").update(text).digest("hex");
const history = (url: string) => sql(url, "select version || '|' || name || '|' || md5(statements[1]) || '|' || coalesce(statements[2], '') from supabase_migrations.schema_migrations order by version");

beforeAll(() => {
  if (!LOOPBACK) return;
  bash = bashExecutable();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-apply-live-"));
  execFileSync("psql", ["--version"], { encoding: "utf8" });
}, 60_000);

afterAll(() => {
  for (const h of holders) h.kill();
  for (const db of databases) {
    try { sql(ADMIN, `drop database if exists ${db} with (force)`); } catch { /* reported by the next run's leftovers, never fatal here */ }
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const A = "20261114093000_widgets.sql";
const A_SQL = "create table widgets (id int primary key);\ninsert into widgets values (1);\n";
const B = "20261114093001_gadgets.sql";

describe.skipIf(!LOOPBACK)("migrations-apply.sh applies each file in one transaction and records it", () => {
  it("applies a pending file and records its version, name, exact text and the runner's marker", () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    const r = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(`applying: ${DIR}/${A}`);
    expect(sql(db, "select count(*) from widgets")).toBe("1");
    expect(history(db)).toBe(`20261114093000|widgets|${md5(A_SQL)}|${MARKER}`);
  });

  it("a second run applies nothing", () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    expect(apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db }).status).toBe(0);
    const again = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain(`already applied: ${DIR}/${A}`);
    expect(again.output).not.toContain("applying:");
    expect(history(db).split("\n")).toHaveLength(1);
  });

  it("--dry-run applies nothing", () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    const r = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db }, ["--dry-run"]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(`pending: ${DIR}/${A}`);
    expect(sql(db, "select to_regclass('public.widgets') is null")).toBe("t");
    expect(history(db)).toBe("");
  });

  it("a file failing at its LAST statement leaves neither its table nor its row, and is tried once (mutation: drop the transaction, or ON_ERROR_STOP → FAILS)", () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: "create table half (id int);\ninsert into half values (1);\nselect 1 / 0;\n" });
    const r = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114093000_widgets\.sql failed and was rolled back/);
    expect(r.output.match(/division by zero/g)).toHaveLength(1);
    expect(sql(db, "select to_regclass('public.half') is null")).toBe("t");
    expect(history(db)).toBe("");
  });

  it("when the second file fails, the first stays applied and recorded", () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL, [B]: "create table gadgets (id int);\nselect 1 / 0;\n" });
    const r = apply(dir, "local-as-bis-ci", [A, B], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/gadgets\.sql failed and was rolled back.*1 file\(s\) before it/);
    expect(history(db)).toBe(`20261114093000|widgets|${md5(A_SQL)}|${MARKER}`);
    expect(sql(db, "select to_regclass('public.gadgets') is null")).toBe("t");
  });

  it("refuses a recorded file whose content changed, and applies nothing (mutation: make the digest compare always true → FAILS)", () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    expect(apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db }).status).toBe(0);
    fs.writeFileSync(path.join(dir, DIR, A), `${A_SQL}insert into widgets values (2);\n`);
    const r = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*different content/);
    expect(sql(db, "select count(*) from widgets")).toBe("1");
  });
});

describe.skipIf(!LOOPBACK)("migrations-apply.sh keeps production safe", () => {
  it("prints psql's error tersely: a failing constraint never prints the customer's row (mutation: drop VERBOSITY terse → FAILS)", () => {
    const db = scratchDatabase();
    sql(db, "create table customers (email text unique); insert into customers values ('jane.customer@example.com');");
    const dir = tree({ [A]: "insert into customers values ('jane.customer@example.com');\n" });
    const r = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/duplicate key value violates unique constraint/);
    expect(r.output).not.toContain("DETAIL");
    expect(r.output).not.toContain("jane.customer");
  });

  it("gives up after lock_timeout when another session holds the history lock, rather than waiting (mutation: drop lock_timeout → FAILS)", async () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    const holder = spawn("psql", [db, "-X", "-q", "-c", "begin; lock table supabase_migrations.schema_migrations in share row exclusive mode; select pg_sleep(40); commit;"], { stdio: "ignore" });
    holders.push(holder);
    const deadline = Date.now() + 15_000;
    while (sql(db, "select count(*) from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'schema_migrations' and l.mode = 'ShareRowExclusiveLock' and l.granted") !== "1") {
      if (Date.now() > deadline) throw new Error("the lock holder never took its lock");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const r = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    holder.kill();
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/lock timeout/);
    expect(r.ms).toBeLessThan(30_000);
    expect(sql(db, "select to_regclass('public.widgets') is null")).toBe("t");
  });

  it("bis-ci first, then production: production applies only what bis-ci holds, with the same content", () => {
    const bisci = scratchDatabase();
    const prod = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    const asProd = { BIS_MIGRATIONS_DB_URL: prod, BIS_MIGRATIONS_BISCI_DB_URL: bisci };

    const notYet = apply(dir, "local-as-production", [A], asProd);
    expect(notYet.status).toBe(1);
    expect(notYet.output).toMatch(/::error::.*widgets\.sql is not on bis-ci/);
    expect(history(prod)).toBe("");

    expect(apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: bisci }).status).toBe(0);
    const r = apply(dir, "local-as-production", [A], asProd);
    expect(r.status, r.output).toBe(0);
    expect(history(prod)).toBe(history(bisci));
  });

  it("bis-ci refuses a file older than a version it already holds; production, where approvals arrive in any order, applies it", () => {
    const bisci = scratchDatabase();
    const prod = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    expect(apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: bisci }).status).toBe(0);
    const later = "insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261120000000', 'later_branch', '{}')";
    sql(bisci, later);
    sql(prod, later);

    // A second branch's file, older than the version bis-ci now holds.
    const older = "20261114093002_older.sql";
    const branch = tree({ [A]: A_SQL, [older]: "create table older (id int);\n" });
    const ci = apply(branch, "local-as-bis-ci", [A, older], { BIS_MIGRATIONS_DB_URL: bisci });
    expect(ci.status).toBe(1);
    expect(ci.output).toMatch(/::error::.*20261114093002_older\.sql is older than 20261120000000/);

    // Production holds the later version too, and still takes A, which is older.
    const r = apply(dir, "local-as-production", [A], { BIS_MIGRATIONS_DB_URL: prod, BIS_MIGRATIONS_BISCI_DB_URL: bisci });
    expect(r.status, r.output).toBe(0);
    expect(sql(prod, "select count(*) from widgets")).toBe("1");
  });
});
