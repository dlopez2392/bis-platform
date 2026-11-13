import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .github/scripts/ci-migrations-applied.sh, run by the e2e job before it
// seeds the CI project.
//
// Why it exists (PR #200 review, 2026-10-08). Until verify moved to a local
// stack, verify's db suite ran on the CI project, so a branch whose new
// migration had not been pushed there went red, and CLAUDE.md's "every new
// migration goes to the CI project FIRST" was enforced by accident. verify now
// builds its database from the branch's own files and passes either way, so
// a branch could merge (and deploy) a migration bis-ci never received. This
// script is the gate instead: every migration file in the branch must be in
// bis-ci's supabase_migrations.schema_migrations, by the version the CLI's
// `db push` records (the file name's numeric prefix). A row bis-ci has and the
// branch does not (another branch applied first) is NOT a failure.
//
// Run for real through bash, against the repository's real migration files,
// with a fake `psql` first on PATH that answers with the version list each
// case gives it. No case reaches a database.

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const toBashPath = (p: string) => p.replace(/\\/g, "/");
const SCRIPT = toBashPath(path.join(REPO, ".github/scripts/ci-migrations-applied.sh"));
const MIGRATION_FILES = fs.readdirSync(path.join(REPO, "packages/db/supabase/migrations"))
  .filter((f) => f.endsWith(".sql")).sort();
const VERSIONS = MIGRATION_FILES.map((f) => f.split("_")[0]!);
/** bis-ci's rows for the real files as `psql -tA` prints `select version, name`: the CLI's split of each name. */
const pairOf = (file: string) => {
  const stem = file.slice(0, -".sql".length);
  const at = stem.indexOf("_");
  return `${stem.slice(0, at)}|${stem.slice(at + 1)}`;
};
const PAIRS = MIGRATION_FILES.map(pairOf);
const DB_PASSWORD = "UnitTestCiPoolerPassword_6a2e";
const CI_REF = "cirefcirefcirefciref";
const PROD_REF = "tlbkbmlrfafquucsmsmm";
const poolerUrl = (ref: string) => `postgresql://postgres.${ref}:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const DB_URL = poolerUrl(CI_REF);

// One log line per call, each argument kept whole inside [[…]], so a case can
// tell one `-c "a; b"` from two `-c a -c b`.
const FAKE_PSQL = `#!/usr/bin/env bash
{ printf 'psql'; for a in "$@"; do printf ' [[%s]]' "$a"; done; printf ' PGPASSWORD=%s PGSSLMODE=%s\\n' "\${PGPASSWORD:-}" "\${PGSSLMODE:-}"; } >> "$FAKE_DIR/log"
if [ -n "\${FAKE_PSQL_STDERR:-}" ]; then printf '%s\\n' "$FAKE_PSQL_STDERR" >&2; fi
printf '%s' "$FAKE_APPLIED"
exit "\${FAKE_PSQL_EXIT:-0}"
`;

vi.setConfig({ testTimeout: 30_000 });

let fakeDir = "";
let bash = "";

function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  const bashUnder = (root: string) => path.join(root, "usr", "bin", "bash.exe");
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter((b): b is string => Boolean(b)).map((b) => path.join(b, "Git"));
  const found = roots.find((root) => fs.existsSync(bashUnder(root)));
  if (found) return bashUnder(found);
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const root = path.resolve(execPath, "..", "..", "..");
  if (fs.existsSync(bashUnder(root))) return bashUnder(root);
  throw new Error(`No Git for Windows bash found (looked under: ${[...roots, root].join(", ")})`);
}

beforeAll(() => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-migrations-applied-"));
  fs.mkdirSync(path.join(fakeDir, "bin"));
  fs.writeFileSync(path.join(fakeDir, "bin", "psql"), FAKE_PSQL, { mode: 0o755 });
  bash = bashExecutable();
  const warm = spawnSync(bash, ["-c", ":"], { encoding: "utf8" });
  if (warm.error) throw warm.error;
}, 60_000);

afterAll(() => {
  fs.rmSync(fakeDir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(fakeDir, "log"), { force: true });
});

type Run = { status: number | null; output: string; log: string[] };

/**
 * `applied` is what bis-ci's history holds, one `version|name` row per line, as
 * `psql -tA` prints it. `cwd` is the tree whose migrations are checked: the
 * repository, or a scratch tree holding only the files a case names.
 */
function run(applied: string[], extraEnv: Record<string, string | undefined> = {}, cwd = REPO): Run {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${path.join(fakeDir, "bin")}${path.delimiter}${env[pathKey] ?? ""}`;
  Object.assign(env, {
    FAKE_DIR: toBashPath(fakeDir),
    FAKE_APPLIED: applied.map((v) => `${v}\n`).join(""),
    // The step-scoped names ci.yml gives this step alone (2026-10-08), never
    // the app's SUPABASE_DB_URL, which in the e2e job is the local stack's.
    BIS_CI_SUPABASE_REF: CI_REF,
    BIS_CI_SUPABASE_DB_URL: DB_URL,
  });
  delete env.SUPABASE_DB_URL;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(bash, [SCRIPT], { env, encoding: "utf8", cwd });
  if (r.error) throw r.error;
  const output = `${r.stdout}${r.stderr}`;
  expect(output.includes(DB_PASSWORD), "printed the DB password").toBe(false);
  const logFile = path.join(fakeDir, "log");
  return {
    status: r.status,
    output,
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [],
  };
}

describe("ci-migrations-applied.sh: every migration in the branch is on the CI project", () => {
  it("finds the repository's migrations (the test is not comparing nothing)", () => {
    expect(MIGRATION_FILES.length).toBeGreaterThan(50);
    expect(VERSIONS.every((v) => /^[0-9]+$/.test(v))).toBe(true);
  });

  it("passes when bis-ci holds every one, and reads the CLI's own history table from the CI project, its password in PGPASSWORD and never on psql's command line, over TLS (mutation: pass the URL whole → FAILS)", () => {
    const r = run(PAIRS);
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toContain("supabase_migrations.schema_migrations");
    const args = [...(r.log[0] ?? "").matchAll(/\[\[([\s\S]*?)\]\]/g)].map((m) => m[1]!);
    expect(args).toContain(`postgresql://postgres.${CI_REF}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`);
    expect(args.join(" ")).not.toContain(DB_PASSWORD);
    expect(r.log[0]).toContain(`PGPASSWORD=${DB_PASSWORD} PGSSLMODE=require`);
  });

  it("fails naming EACH missing migration file, and only those, with the fix (mutation: exit 0 whatever is missing → FAILS)", () => {
    const first = MIGRATION_FILES[0]!;
    const last = MIGRATION_FILES[MIGRATION_FILES.length - 1]!;
    const r = run(PAIRS.slice(1, -1));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${first.replace(".", "\\.")}`));
    expect(r.output).toMatch(new RegExp(`::error::.*${last.replace(".", "\\.")}`));
    expect(r.output).not.toContain(MIGRATION_FILES[1]!);
    expect(r.output).toContain("ci-project-setup.yml");
    expect(r.output).toContain("docs/runbooks/ci-supabase-project.md");
  });

  it("does NOT fail when bis-ci holds migrations this branch lacks: another branch applied first (mutation: also fail on extra rows → FAILS)", () => {
    const r = run([...PAIRS, "9998|other_branch", "20990101000000|other_branch_too"]);
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
  });

  it("treats an empty history as every migration missing, never as nothing to check", () => {
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(MIGRATION_FILES[0]!);
  });

  it("tolerates the whitespace and carriage returns psql can print around a version", () => {
    const r = run(PAIRS.map((v) => ` ${v}\r`));
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
  });

  it("fails, loudly, when it cannot read bis-ci's history at all: a gate that cannot check is red, not skipped (mutation: `|| true` on the psql read → FAILS)", () => {
    const r = run(PAIRS, { FAKE_PSQL_EXIT: "2", FAKE_PSQL_STDERR: "psql: error: connection refused" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*could not read/i);
  });

  it.each(["BIS_CI_SUPABASE_DB_URL", "BIS_CI_SUPABASE_REF"])("refuses to run without %s, naming it, and never calls psql", (name) => {
    const r = run(PAIRS, { [name]: undefined });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${name}`));
    expect(r.log).toEqual([]);
  });
});

// Since 2026-10-08 the e2e job runs on a stack inside its own runner and
// holds NO CI-project value for the app: this step alone reads bis-ci, with
// its own step-scoped names, and it no longer has the CI-project guard in
// front of it. So it checks what it was handed before psql sees it, and
// reads in one read-only transaction: it is a check, and must never be able
// to write to the project local runs and Vercel Preview share.
describe("ci-migrations-applied.sh reads bis-ci only, read-only, and only from its own variables", () => {
  it("never falls back to the app's SUPABASE_DB_URL, which in e2e is the local stack's (mutation: read SUPABASE_DB_URL → FAILS)", () => {
    const r = run(PAIRS, { BIS_CI_SUPABASE_DB_URL: undefined, SUPABASE_DB_URL: DB_URL });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*BIS_CI_SUPABASE_DB_URL/);
    expect(r.log).toEqual([]);
  });

  it.each([
    ["another project's pooler user", poolerUrl("otherotherotherother")],
    ["the direct host (user postgres)", `postgresql://postgres:${DB_PASSWORD}@db.${CI_REF}.supabase.co:5432/postgres`],
    ["the local stack's database", `postgresql://postgres:${DB_PASSWORD}@127.0.0.1:54322/postgres`],
    ["a host override in the query string", `${DB_URL}?host=evil.example`],
    ["an upper-case scheme", DB_URL.replace("postgresql://", "POSTGRESQL://")],
  ])("refuses %s before psql sees it (mutation: drop the URL check → FAILS)", (_label, url) => {
    const r = run(PAIRS, { BIS_CI_SUPABASE_DB_URL: url });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*BIS_CI_SUPABASE_DB_URL.*Session pooler/);
    expect(r.log).toEqual([]);
  });

  // psql echoes a password it cannot percent-decode ("invalid percent-encoded
  // token: ..."), so such a URL is refused before psql sees it (review of #367).
  it.each(["Hunter%zz2SecretTail", "Hunter%002SecretTail"])("refuses a password that is not valid percent-encoding (%s), without printing it (mutation: back to the loose password class → FAILS)", (pw) => {
    const r = run(PAIRS, { BIS_CI_SUPABASE_DB_URL: DB_URL.replace(DB_PASSWORD, pw) });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*BIS_CI_SUPABASE_DB_URL.*Session pooler/);
    expect(r.output).not.toContain("Hunter");
    expect(r.log).toEqual([]);
  });

  it("refuses production by name, wherever its ref appears, before psql sees it", () => {
    const r = run(PAIRS, { BIS_CI_SUPABASE_REF: PROD_REF, BIS_CI_SUPABASE_DB_URL: poolerUrl(PROD_REF) });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*production/);
    expect(r.log).toEqual([]);
  });

  it("accepts the Session pooler URI with ?sslmode=require, the one query ci:seed's target check also allows", () => {
    const r = run(PAIRS, { BIS_CI_SUPABASE_DB_URL: `${DB_URL}?sslmode=require` });
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
  });

  // Review M-4 (2026-10-08). The URL check admits the transaction pooler
  // (6543) as well as the session pooler (5432). Through a transaction
  // pooler each TRANSACTION may run on a different server connection, so a
  // `set session characteristics … read only` sent as its own command can
  // land on one connection and the read on another, read-write. One command
  // holding `begin transaction read only; select …; commit;` is one
  // transaction, which a transaction pooler keeps on one connection.
  it.each([
    ["the session pooler (5432)", DB_URL],
    ["the transaction pooler (6543)", DB_URL.replace(":5432/", ":6543/")],
  ])("reads the history in ONE read-only transaction sent as ONE command, through %s (mutation: a separate SET, or no `begin transaction read only` → FAILS)", (_label, url) => {
    const r = run(PAIRS, { BIS_CI_SUPABASE_DB_URL: url });
    expect(r.status, r.output).toBe(0);
    expect(r.log).toHaveLength(1);
    const args = [...(r.log[0] ?? "").matchAll(/\[\[(.*?)\]\]/g)].map((m) => m[1]!);
    // The connection, without its password (that travels in PGPASSWORD).
    expect(args).toContain(url.replace(`:${DB_PASSWORD}@`, "@"));
    const commands = args.filter((_, i) => args[i - 1] === "-c");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatch(
      /^begin transaction read only; *select version, name from supabase_migrations\.schema_migrations order by version; *commit;$/,
    );
    // Stops at the first error, so a refused BEGIN can never fall through to
    // a read outside the transaction.
    expect(args.join(" ")).toContain("ON_ERROR_STOP=1");
  });

  it("counts only version lines, so a status line psql prints is never read as a migration bis-ci holds", () => {
    const r = run(["BEGIN", "SET", ...PAIRS, "COMMIT"]);
    expect(r.status).toBe(0);
    expect(r.output).not.toMatch(/holds \d+ migration/);
  });
});

// Since 2026-11-13 new migrations are timestamped (packages/db/src/migrations/names.ts)
// and a file is in a project's history when a row matches the PAIR (version, name),
// or, for a numbered file only, when a row's name is the whole stem: production's
// MCP rows, whose version is the moment of the apply (plan D1). Never by version
// alone: an MCP row's apply timestamp can equal a new file's version.
describe("ci-migrations-applied.sh matches a file by (version, name), not by version", () => {
  const LEGACY = "0115_owner_line.sql";
  const NEW = "20261114093000_work_queue.sql";
  let tree = "";

  beforeAll(() => {
    tree = fs.mkdtempSync(path.join(os.tmpdir(), "ci-migrations-tree-"));
    const dir = path.join(tree, "packages/db/supabase/migrations");
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [LEGACY, NEW]) fs.writeFileSync(path.join(dir, f), "select 1;\n");
  });
  afterAll(() => {
    fs.rmSync(tree, { recursive: true, force: true });
  });

  const inTree = (applied: string[]) => run(applied, {}, tree);

  it("finds a timestamped file by its pair, as the CLI records it", () => {
    const r = inTree(["0115|owner_line", "20261114093000|work_queue"]);
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
  });

  it("does NOT count a row with the file's version under another name, and says to rename (mutation: match by version only → FAILS)", () => {
    const r = inTree(["0115|owner_line", "20261114093000|someone_elses"]);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${NEW.replace(".", "\\.")}.*someone_elses`));
    expect(r.output).toMatch(/migration:new/);
  });

  it("does NOT count a row with the file's version and no name", () => {
    const r = inTree(["0115|owner_line", "20261114093000|"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(NEW);
  });

  it("finds a numbered file by production's MCP form: name is the whole stem, version the apply time", () => {
    const r = inTree(["20261110183000|0115_owner_line", "20261114093000|work_queue"]);
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
  });

  it("does NOT let the whole-stem form stand in for a timestamped file (mutation: accept name = stem for every file → FAILS)", () => {
    const r = inTree(["0115|owner_line", "20261201000000|20261114093000_work_queue"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(NEW);
  });
});
