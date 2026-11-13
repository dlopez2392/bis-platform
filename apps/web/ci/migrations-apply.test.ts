import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .github/scripts/migrations-apply.sh: the migration runner (plan
// docs/superpowers/plans/2026-11-13-migration-pipeline.md, D1-D3, PR 3).
// Nothing in CI calls it yet (PR 4 applies to bis-ci, PR 5 to production).
//
// These cases run it for real through bash, with a fake `psql` first on
// PATH that answers the history read with the rows each case gives it, and
// logs every call. They pin what is decided BEFORE anything is applied: which
// targets and URLs it accepts, which files it takes, and which history rows
// count as a file being applied (D1, including production's three forms, A3).
// What applying does is proved against a real Postgres in
// migrations-apply.live.test.ts.

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const toBashPath = (p: string) => p.replace(/\\/g, "/");
const SCRIPT = toBashPath(path.join(REPO, ".github/scripts/migrations-apply.sh"));
const DIR = "packages/db/supabase/migrations";
const SEP = "\x1f";
const PASSWORD = "UnitTestRunnerPassword_93f1";
const PROD_REF = "tlbkbmlrfafquucsmsmm";
const CI_REF = "cirefcirefcirefciref";
const pooler = (ref: string, port = 5432) => `postgresql://postgres.${ref}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:${port}/postgres`;
const LOCAL = `postgresql://postgres:${PASSWORD}@127.0.0.1:5001/postgres`;
const LOCAL_BISCI = `postgresql://postgres:${PASSWORD}@127.0.0.1:5002/postgres`;

// One log line per call: every argument kept whole inside [[...]], then the
// PG* variables it was handed. It answers with the target's rows, or bis-ci's
// when the URL names port 5002 or the CI project's ref.
const FAKE_PSQL = `#!/usr/bin/env bash
{ printf 'psql'; for a in "$@"; do printf ' [[%s]]' "$a"; done; printf ' PGHOST=%s PGOPTIONS=%s\\n' "\${PGHOST:-}" "\${PGOPTIONS:-}"; } >> "$FAKE_DIR/log"
case "$*" in
  *:5002/*|*postgres.${CI_REF}:*) printf '%s' "$FAKE_BISCI_ROWS" ;;
  *) printf '%s' "$FAKE_TARGET_ROWS" ;;
esac
exit "\${FAKE_PSQL_EXIT:-0}"
`;

vi.setConfig({ testTimeout: 30_000 });

let root = "";
let bash = "";

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

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-apply-"));
  fs.mkdirSync(path.join(root, "bin"));
  fs.writeFileSync(path.join(root, "bin", "psql"), FAKE_PSQL, { mode: 0o755 });
  bash = bashExecutable();
}, 60_000);

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

let tree = "";
beforeEach(() => {
  tree = fs.mkdtempSync(path.join(root, "tree-"));
  fs.mkdirSync(path.join(tree, DIR), { recursive: true });
  fs.rmSync(path.join(root, "log"), { force: true });
});

/** Files in the scratch tree's migrations directory. */
function files(contents: Record<string, string>) {
  for (const [name, sql] of Object.entries(contents)) fs.writeFileSync(path.join(tree, DIR, name), sql);
}
const md5 = (name: string) => createHash("md5").update(fs.readFileSync(path.join(tree, DIR, name))).digest("hex");
const rows = (...r: [string, string, string?][]) => r.map(([v, n, d]) => `${v}${SEP}${n}${SEP}${d ?? ""}\n`).join("");

type Run = { status: number | null; output: string; log: string[] };

function run(args: string[], env: Record<string, string | undefined> = {}): Run {
  const e: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(e).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  e[pathKey] = `${path.join(root, "bin")}${path.delimiter}${e[pathKey] ?? ""}`;
  for (const k of Object.keys(e)) if (k.startsWith("BIS_") || k === "GITHUB_ACTIONS") delete e[k];
  Object.assign(e, { FAKE_DIR: toBashPath(root), FAKE_TARGET_ROWS: "", FAKE_BISCI_ROWS: "" });
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  const r = spawnSync(bash, [SCRIPT, ...args], { env: e, encoding: "utf8", cwd: tree });
  if (r.error) throw r.error;
  const output = `${r.stdout}${r.stderr}`;
  expect(output.includes(PASSWORD), "printed a password").toBe(false);
  const logFile = path.join(root, "log");
  return { status: r.status, output, log: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [] };
}

const NEW = "20261114093000_work_queue.sql";
const asLocalBisCi = (target: string, extra: Record<string, string | undefined> = {}) =>
  ({ BIS_MIGRATIONS_DB_URL: LOCAL, FAKE_TARGET_ROWS: target, ...extra });
const asLocalProd = (target: string, bisci: string, extra: Record<string, string | undefined> = {}) =>
  ({ BIS_MIGRATIONS_DB_URL: LOCAL, BIS_MIGRATIONS_BISCI_DB_URL: LOCAL_BISCI, FAKE_TARGET_ROWS: target, FAKE_BISCI_ROWS: bisci, ...extra });

describe("migrations-apply.sh accepts only its own targets, and never prints a URL", () => {
  beforeEach(() => files({ [NEW]: "create table t (id int);\n" }));
  const file = `${DIR}/${NEW}`;

  it.each([
    ["production's ref", { BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: pooler(PROD_REF) }, /production/],
    ["another project's pooler user", { BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: pooler("otherotherotherother") }, /BIS_MIGRATIONS_DB_URL.*Session pooler/],
    ["the transaction pooler (6543)", { BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: pooler(CI_REF, 6543) }, /BIS_MIGRATIONS_DB_URL.*Session pooler/],
    ["no CI project ref", { BIS_MIGRATIONS_DB_URL: pooler(CI_REF) }, /BIS_CI_SUPABASE_REF/],
    ["the CI project ref set to production's", { BIS_CI_SUPABASE_REF: PROD_REF, BIS_MIGRATIONS_DB_URL: pooler(PROD_REF) }, /production/],
  ])("bis-ci: refuses %s before psql runs (mutation: drop the production-ref refusal → FAILS)", (_l, env, why) => {
    const r = run(["--target", "bis-ci", file], env);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${why.source}`));
    expect(r.log).toEqual([]);
  });

  it.each([
    ["outside GitHub Actions", { BIS_MIGRATIONS_DB_URL: pooler(PROD_REF), BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_BISCI_DB_URL: pooler(CI_REF) }, /GITHUB_ACTIONS/],
    ["a URL that is not production's pooler user", { GITHUB_ACTIONS: "true", BIS_MIGRATIONS_DB_URL: pooler(CI_REF), BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_BISCI_DB_URL: pooler(CI_REF) }, /BIS_MIGRATIONS_DB_URL/],
    ["no bis-ci URL to compare with", { GITHUB_ACTIONS: "true", BIS_MIGRATIONS_DB_URL: pooler(PROD_REF), BIS_CI_SUPABASE_REF: CI_REF }, /BIS_MIGRATIONS_BISCI_DB_URL/],
    ["a bis-ci URL that names production", { GITHUB_ACTIONS: "true", BIS_MIGRATIONS_DB_URL: pooler(PROD_REF), BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_BISCI_DB_URL: pooler(PROD_REF) }, /BIS_MIGRATIONS_BISCI_DB_URL/],
  ])("production: refuses %s before psql runs", (_l, env, why) => {
    const r = run(["--target", "production", file], env);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${why.source}`));
    expect(r.log).toEqual([]);
  });

  it.each([
    ["a pooler host", pooler(CI_REF)],
    ["a remote host", `postgresql://postgres:${PASSWORD}@db.example.com:5432/postgres`],
    ["production's ref on loopback", `postgresql://postgres.${PROD_REF}:${PASSWORD}@127.0.0.1:5001/postgres`],
    ["a query string", `${LOCAL}?host=db.example.com`],
  ])("local-as-*: refuses %s (loopback only, for tests)", (_l, url) => {
    for (const target of ["local-as-bis-ci", "local-as-production"]) {
      const r = run(["--target", target, file], { BIS_MIGRATIONS_DB_URL: url, BIS_MIGRATIONS_BISCI_DB_URL: LOCAL_BISCI });
      expect(r.status, target).toBe(1);
      expect(r.output).toMatch(/::error::.*BIS_MIGRATIONS_DB_URL/);
      expect(r.log).toEqual([]);
    }
  });

  it("refuses an unknown target and a missing one", () => {
    expect(run(["--target", "prod", file], { BIS_MIGRATIONS_DB_URL: LOCAL }).status).toBe(2);
    expect(run([file], { BIS_MIGRATIONS_DB_URL: LOCAL }).status).toBe(2);
  });

  it("hands psql no PG* variable from its environment: the URL is the whole connection", () => {
    const r = run(["--target", "local-as-bis-ci", "--dry-run", file], { ...asLocalBisCi(""), PGHOST: "db.example.com", PGOPTIONS: "-c default_transaction_read_only=off" });
    expect(r.status, r.output).toBe(0);
    expect(r.log[0]).toContain("PGHOST= PGOPTIONS=");
  });

  it("reads history in ONE read-only transaction sent as one command, giving up on a held lock after 5s rather than waiting", () => {
    const r = run(["--target", "local-as-bis-ci", "--dry-run", file], asLocalBisCi(""));
    const args = [...(r.log[0] ?? "").matchAll(/\[\[([\s\S]*?)\]\]/g)].map((m) => m[1]!);
    const commands = args.filter((_, i) => args[i - 1] === "-c");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatch(/^begin transaction read only; set local lock_timeout = '5s'; select version, .* from supabase_migrations\.schema_migrations order by version; commit;$/);
  });

  it("fails closed when the history cannot be read", () => {
    const r = run(["--target", "local-as-bis-ci", "--dry-run", file], asLocalBisCi("", { FAKE_PSQL_EXIT: "2" }));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*could not read/i);
  });
});

describe("migrations-apply.sh takes only timestamped migration files from the repository root", () => {
  it.each([
    ["a numbered file", "0117_x.sql", /timestamped/],
    ["a file outside the migrations directory", "../x.sql", /packages\/db\/supabase\/migrations/],
    ["a file that does not exist", "20261114093001_missing.sql", /does not exist/],
  ])("refuses %s", (_l, name, why) => {
    files({ [NEW]: "select 1;\n", "0117_x.sql": "select 1;\n" });
    const r = run(["--target", "local-as-bis-ci", "--dry-run", `${DIR}/${name}`], asLocalBisCi(rows(["0117", "x"])));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${why.source}`));
  });

  it("refuses to run anywhere but the repository root", () => {
    fs.rmSync(path.join(tree, "packages"), { recursive: true });
    const r = run(["--target", "local-as-bis-ci", "--dry-run"], asLocalBisCi(""));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*repository root/);
  });
});

// D1 as amended by A3: production's legacy rows come in three forms.
describe("migrations-apply.sh decides which files are applied by D1's rules", () => {
  const LEGACY = { "0001_tenancy.sql": "select 1;\n", "0012_widgets.sql": "select 2;\n", "0060_gadgets.sql": "select 3;\n" };
  const prodLegacyRows: [string, string, string?][] = [
    ["0001", "tenancy"], // the CLI's pair (0001-0011)
    ["20260901120000", "0012_widgets"], // the MCP's whole stem
    ["20261001120000", "gadgets"], // the MCP's slug alone (0032, 0042-0045, 0060-0115)
  ];

  it("production: a legacy file is covered by the CLI's pair, the whole stem, or its slug alone", () => {
    files({ ...LEGACY, [NEW]: "select 4;\n" });
    const r = run(["--target", "local-as-production", "--dry-run", `${DIR}/${NEW}`],
      asLocalProd(rows(...prodLegacyRows), rows([NEW.slice(0, 14), "work_queue", md5(NEW)])));
    expect(r.output).not.toContain("::error::");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(`pending: ${DIR}/${NEW}`);
  });

  it("production: refuses a slug-only match that two rows share, as ambiguous (mutation: take the first → FAILS)", () => {
    files({ ...LEGACY });
    const r = run(["--target", "local-as-production", "--dry-run"],
      asLocalProd(rows(...prodLegacyRows, ["20261002120000", "gadgets"]), ""));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*0060_gadgets\.sql.*two or more/);
  });

  it("bis-ci: only the pair covers a legacy file; a stem or slug-only row leaves main's file missing (behind main)", () => {
    files({ ...LEGACY });
    const r = run(["--target", "local-as-bis-ci", "--dry-run"], asLocalBisCi(rows(...prodLegacyRows)));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*0012_widgets\.sql.*behind main/);
    expect(r.output).toMatch(/::error::.*0060_gadgets\.sql.*behind main/);
    expect(r.output).not.toMatch(/0001_tenancy\.sql.*behind main/);
  });

  it("production: a timestamped file is covered by the runner's pair or a hand-applied whole stem", () => {
    files({ [NEW]: "select 4;\n", "20261114093001_by_hand.sql": "select 5;\n" });
    const r = run(["--target", "local-as-production", "--dry-run", `${DIR}/${NEW}`],
      asLocalProd(rows([NEW.slice(0, 14), "work_queue", md5(NEW)], ["20261115000000", "20261114093001_by_hand"]), ""));
    expect(r.output).not.toContain("::error::");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(`already applied: ${DIR}/${NEW}`);
  });

  it("production: a timestamped file is NEVER covered by its slug alone (mutation: accept slug-only rows for timestamped files → FAILS)", () => {
    files({ [NEW]: "select 4;\n" });
    const r = run(["--target", "local-as-production", "--dry-run", `${DIR}/${NEW}`],
      asLocalProd(rows(["20261115000000", "work_queue"]), rows([NEW.slice(0, 14), "work_queue", md5(NEW)])));
    expect(r.output).toContain(`pending: ${DIR}/${NEW}`);
    expect(r.output).not.toContain("already applied");
  });

  it("refuses a file this branch does not add that the target lacks: it is behind main", () => {
    files({ "20261114080000_other.sql": "select 1;\n", [NEW]: "select 2;\n" });
    const r = run(["--target", "local-as-bis-ci", "--dry-run", `${DIR}/${NEW}`], asLocalBisCi(""));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114080000_other\.sql.*behind main/);
  });

  it("refuses a recorded file whose content changed: append-only (mutation: make the digest compare always true → FAILS)", () => {
    files({ [NEW]: "select 4;\n" });
    const r = run(["--target", "local-as-bis-ci", "--dry-run", `${DIR}/${NEW}`],
      asLocalBisCi(rows([NEW.slice(0, 14), "work_queue", "0".repeat(32)])));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114093000_work_queue\.sql.*different content.*NEW migration/);
  });

  it("refuses a pending file whose version the target records under another name", () => {
    files({ [NEW]: "select 4;\n" });
    const r = run(["--target", "local-as-bis-ci", "--dry-run", `${DIR}/${NEW}`],
      asLocalBisCi(rows([NEW.slice(0, 14), "someone_elses"])));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114093000_work_queue\.sql.*someone_elses/);
  });

  it("bis-ci: refuses a pending file older than a version bis-ci already holds; production allows it", () => {
    files({ [NEW]: "select 4;\n" });
    const later: [string, string, string?] = ["20261120000000", "later_branch"];
    const ci = run(["--target", "local-as-bis-ci", "--dry-run", `${DIR}/${NEW}`], asLocalBisCi(rows(later)));
    expect(ci.status).toBe(1);
    expect(ci.output).toMatch(/::error::.*20261114093000_work_queue\.sql.*20261120000000.*migration:new/);
    const prod = run(["--target", "local-as-production", "--dry-run", `${DIR}/${NEW}`],
      asLocalProd(rows(later), rows(later, [NEW.slice(0, 14), "work_queue", md5(NEW)])));
    expect(prod.output).not.toContain("::error::");
    expect(prod.status, prod.output).toBe(0);
  });

  it.each([
    ["not on bis-ci at all", () => rows(), /not on bis-ci/],
    ["on bis-ci with different content", () => rows([NEW.slice(0, 14), "work_queue", "0".repeat(32)]), /differs from bis-ci/],
    ["on bis-ci, but not recorded by this runner (no content to compare)", () => rows([NEW.slice(0, 14), "work_queue"]), /not recorded by this runner/],
  ])("production: refuses a pending file %s", (_l, bisci, why) => {
    files({ [NEW]: "select 4;\n" });
    const r = run(["--target", "local-as-production", "--dry-run", `${DIR}/${NEW}`], asLocalProd("", bisci()));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*20261114093000_work_queue\\.sql.*${why.source}`));
  });

  it("--check fails when a file is pending, passes when everything is applied", () => {
    files({ [NEW]: "select 4;\n" });
    const pending = run(["--target", "local-as-bis-ci", "--check", `${DIR}/${NEW}`], asLocalBisCi(""));
    expect(pending.status).toBe(1);
    expect(pending.output).toMatch(/::error::.*20261114093000_work_queue\.sql.*not applied/);
    const done = run(["--target", "local-as-bis-ci", "--check", `${DIR}/${NEW}`], asLocalBisCi(rows([NEW.slice(0, 14), "work_queue", md5(NEW)])));
    expect(done.status, done.output).toBe(0);
  });
});
