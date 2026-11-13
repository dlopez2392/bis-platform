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
    expect(r.output).toMatch(/::error::.*20261114093000_widgets\.sql failed \(SQLSTATE 22012\) and was rolled back/);
    // psql's own line, once: the file was tried once.
    expect(r.output.match(/ERROR: +22012/g)).toHaveLength(1);
    expect(sql(db, "select to_regclass('public.half') is null")).toBe("t");
    expect(history(db)).toBe("");
  });

  it("when the second file fails, the first stays applied and recorded", () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL, [B]: "create table gadgets (id int);\nselect 1 / 0;\n" });
    const r = apply(dir, "local-as-bis-ci", [A, B], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/gadgets\.sql failed \(SQLSTATE 22012\) and was rolled back.*1 file\(s\) before it/);
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

/** The runner, started without waiting for it: two of these race for the history lock. */
function applyAsync(cwd: string, target: string, files: string[], env: Record<string, string>): Promise<Run> {
  const e: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete e.GITHUB_ACTIONS;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(bash, [SCRIPT, "--target", target, ...files.map((f) => `${DIR}/${f}`)], { cwd, env: e });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output, ms: Date.now() - started }));
  });
}

/** History-lock rows on schema_migrations: those held, or those waited for. */
const lockCount = (db: string, granted: boolean) =>
  Number(sql(db, `select count(*) from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'schema_migrations' and l.mode = 'ShareRowExclusiveLock' and ${granted ? "" : "not "}l.granted`));

async function until(what: string, ok: () => boolean) {
  const deadline = Date.now() + 15_000;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Another session holding the history lock until it is terminated (or 60 s pass). */
async function holdHistoryLock(db: string): Promise<() => void> {
  const holder = spawn("psql", [db, "-X", "-q", "-c", "begin; lock table supabase_migrations.schema_migrations in share row exclusive mode; select pg_sleep(60); commit;"], { stdio: "ignore" });
  holders.push(holder);
  await until("the lock holder", () => lockCount(db, true) === 1);
  const pid = sql(db, "select l.pid from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'schema_migrations' and l.mode = 'ShareRowExclusiveLock' and l.granted");
  return () => { sql(db, `select pg_terminate_backend(${pid})`); };
}

// Seeded customer values that must never reach a public log (review of #367, item 1).
const CUSTOMER = "Jane Customer";
const PHONE = "555-0199 ext 4";

describe.skipIf(!LOOPBACK)("migrations-apply.sh keeps customer data out of the log", () => {
  it.each([
    ["a failing cast, which quotes the value", "select phone::bigint from customers;\n", "22P02"],
    ["a failing constraint, whose detail is the row", `insert into customers values ('${CUSTOMER}', '${PHONE}');\n`, "23505"],
    ["raise exception with the row", "do $$ declare r record; begin select * into r from customers limit 1; raise exception '%', r; end $$;\n", "P0001"],
    // On failure the runner shows psql's stderr, so a NOTICE raised before the
    // error would be shown with it (mutation: drop client_min_messages → FAILS).
    ["a notice with the row, then a failure", "do $$ declare r record; begin select * into r from customers limit 1; raise notice '%', r; end $$;\nselect 1 / 0;\n", "22012"],
  ])("prints only the SQLSTATE for %s (mutation: back to VERBOSITY terse → FAILS)", (_l, migration, code) => {
    const db = scratchDatabase();
    sql(db, `create table customers (name text unique, phone text); insert into customers values ('${CUSTOMER}', '${PHONE}');`);
    const r = apply(tree({ [A]: migration }), "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`failed \\(SQLSTATE ${code}\\)`));
    expect(r.output).not.toContain("Jane");
    expect(r.output).not.toContain("555-0199");
    expect(r.output).not.toContain("DETAIL");
    expect(r.output).not.toMatch(/NOTICE|WARNING/);
  });

  it.each([
    ["raise notice and raise warning with the row", "client_min_messages", "do $$ declare r record; begin select * into r from customers limit 1; raise notice '%', r; raise warning '%', r; end $$;\n"],
    ["a SELECT of the table", "the discarded query output", "select * from customers;\n"],
  ])("applies, printing nothing of %s (mutation: drop %s → FAILS)", (_l, _mutation, migration) => {
    const db = scratchDatabase();
    sql(db, `create table customers (name text unique, phone text); insert into customers values ('${CUSTOMER}', '${PHONE}');`);
    const r = apply(tree({ [A]: `${migration}create table ok_after (id int);\n` }), "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain("Jane");
    expect(r.output).not.toContain("555-0199");
    // Not even the bare level and code: NOTICE and WARNING are never sent.
    expect(r.output).not.toMatch(/NOTICE|WARNING/);
  });
});

describe.skipIf(!LOOPBACK)("migrations-apply.sh keeps production safe", () => {
  it("gives up after lock_timeout when another session holds the history lock, rather than waiting (mutation: drop lock_timeout → FAILS)", async () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    const release = await holdHistoryLock(db);
    const r = apply(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    release();
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/failed \(SQLSTATE 55P03: lock timeout/);
    expect(r.ms).toBeLessThan(30_000);
    expect(sql(db, "select to_regclass('public.widgets') is null")).toBe("t");
  });

  // Two runs at once (review of #367, item 3): both pass their checks before
  // either holds the lock, so the checks are made again INSIDE the lock.
  it("two runs of the same file at once: one applies it, the other writes nothing and says why (mutation: drop the history lock, or the in-lock re-check → FAILS)", async () => {
    const db = scratchDatabase();
    const dir = tree({ [A]: A_SQL });
    const release = await holdHistoryLock(db);
    const first = applyAsync(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    const second = applyAsync(dir, "local-as-bis-ci", [A], { BIS_MIGRATIONS_DB_URL: db });
    await until("both runs to wait for the lock", () => lockCount(db, false) === 2);
    release();
    const runs = await Promise.all([first, second]);
    const ok = runs.filter((r) => r.status === 0);
    const refused = runs.filter((r) => r.status === 1);
    expect(ok, runs.map((r) => r.output).join("\n----\n")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.output).toMatch(/::error::.*widgets\.sql: another run applied it to local-as-bis-ci first; this run wrote nothing/);
    expect(history(db)).toBe(`20261114093000|widgets|${md5(A_SQL)}|${MARKER}`);
  });

  it("bis-ci: a newer file and an older one at once, newer first: the older writes nothing, so bis-ci's order stays file order", async () => {
    const db = scratchDatabase();
    const newer = "20261114093005_newer.sql";
    const older = "20261114093001_older.sql";
    const release = await holdHistoryLock(db);
    const n = applyAsync(tree({ [newer]: "create table newer (id int);\n" }), "local-as-bis-ci", [newer], { BIS_MIGRATIONS_DB_URL: db });
    await until("the newer run to wait for the lock", () => lockCount(db, false) === 1);
    const o = applyAsync(tree({ [older]: "create table older (id int);\n" }), "local-as-bis-ci", [older], { BIS_MIGRATIONS_DB_URL: db });
    await until("the older run to wait too", () => lockCount(db, false) === 2);
    release();
    const [rn, ro] = await Promise.all([n, o]);
    expect(rn.status, rn.output).toBe(0);
    expect(ro.status, ro.output).toBe(1);
    expect(ro.output).toMatch(/::error::.*older\.sql: another run applied a newer migration to local-as-bis-ci first.*wrote nothing.*migration:new/);
    expect(sql(db, "select to_regclass('public.older') is null")).toBe("t");
    expect(history(db).split("\n")).toHaveLength(1);
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
