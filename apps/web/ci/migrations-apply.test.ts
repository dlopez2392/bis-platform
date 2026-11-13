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

// One log line per call: every argument kept whole inside [[...]] (what `ps`
// shows), then the PG* variables it was handed (PGPASSWORD only as set or
// not). An apply (-f) prints nothing and exits FAKE_APPLY_EXIT; a read answers
// with the target's rows, or bis-ci's when the URL names port 5002 or the CI
// project's user.
const FAKE_PSQL = `#!/usr/bin/env bash
{ printf 'psql'; for a in "$@"; do printf ' [[%s]]' "$a"; done; printf ' PGHOST=%s PGOPTIONS=%s PGSSLMODE=%s PGPASSWORD=%s URLS=%s\\n' "\${PGHOST:-}" "\${PGOPTIONS:-}" "\${PGSSLMODE:-}" "\${PGPASSWORD:+set}" "\${BIS_MIGRATIONS_DB_URL:+db}\${BIS_MIGRATIONS_BISCI_DB_URL:+bisci}"; } >> "$FAKE_DIR/log"
case "$*" in *"from items"*) case "$*" in *:5002/*|*postgres.${CI_REF}@*|*postgres.${CI_REF}:*) printf '%s' "$FAKE_BISCI_FP" ;; *) printf '%s' "$FAKE_TARGET_FP" ;; esac; exit "\${FAKE_FP_EXIT:-0}" ;; esac
case " $* " in *" -f "*) touch "$FAKE_DIR/applied"; [ -n "\${FAKE_APPLY_STDERR:-}" ] && printf '%s\\n' "$FAKE_APPLY_STDERR" >&2; exit "\${FAKE_APPLY_EXIT:-0}" ;; esac
case "$*" in
  *:5002/*|*postgres.${CI_REF}@*|*postgres.${CI_REF}:*) printf '%s' "$FAKE_BISCI_ROWS" ;;
  *) if [ -e "$FAKE_DIR/applied" ] && [ -n "\${FAKE_TARGET_ROWS_AFTER:-}" ]; then printf '%s' "$FAKE_TARGET_ROWS_AFTER"; else printf '%s' "$FAKE_TARGET_ROWS"; fi ;;
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
  fs.rmSync(path.join(root, "applied"), { force: true });
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
  Object.assign(e, { FAKE_DIR: toBashPath(root), FAKE_TARGET_ROWS: "", FAKE_BISCI_ROWS: "", FAKE_TARGET_FP: "", FAKE_BISCI_FP: "" });
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
    ["the direct host, not the pooler", { BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: `postgresql://postgres.${CI_REF}:${PASSWORD}@db.${CI_REF}.supabase.co:5432/postgres` }, /BIS_MIGRATIONS_DB_URL.*Session pooler/],
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
    ["the transaction pooler (6543)", { GITHUB_ACTIONS: "true", BIS_MIGRATIONS_DB_URL: pooler(PROD_REF, 6543), BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_BISCI_DB_URL: pooler(CI_REF) }, /BIS_MIGRATIONS_DB_URL.*production's Session pooler/],
    ["the direct host db.<ref>.supabase.co:5432", { GITHUB_ACTIONS: "true", BIS_MIGRATIONS_DB_URL: `postgresql://postgres.${PROD_REF}:${PASSWORD}@db.${PROD_REF}.supabase.co:5432/postgres`, BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_BISCI_DB_URL: pooler(CI_REF) }, /BIS_MIGRATIONS_DB_URL.*production's Session pooler/],
    ["BIS_CI_SUPABASE_REF set to production's, so bis-ci's URL could be production's", { GITHUB_ACTIONS: "true", BIS_MIGRATIONS_DB_URL: pooler(PROD_REF), BIS_CI_SUPABASE_REF: PROD_REF, BIS_MIGRATIONS_BISCI_DB_URL: pooler(PROD_REF) }, /BIS_CI_SUPABASE_REF/],
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

  // A password psql cannot decode is echoed back whole by psql's own error
  // ("invalid percent-encoded token: ..."), so it is refused before psql runs
  // (review of #367, item 2).
  const BAD = ["Hunter%zz2SecretTail", "Hunter%002SecretTail"];
  it.each(BAD)("refuses a password that is not valid percent-encoding (%s) for every target, without printing it", (pw) => {
    const cases: [string, Record<string, string>][] = [
      ["bis-ci", { BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: pooler(CI_REF).replace(PASSWORD, pw) }],
      ["production", { GITHUB_ACTIONS: "true", BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: pooler(PROD_REF).replace(PASSWORD, pw), BIS_MIGRATIONS_BISCI_DB_URL: pooler(CI_REF) }],
      ["production", { GITHUB_ACTIONS: "true", BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: pooler(PROD_REF), BIS_MIGRATIONS_BISCI_DB_URL: pooler(CI_REF).replace(PASSWORD, pw) }],
      ["local-as-bis-ci", { BIS_MIGRATIONS_DB_URL: LOCAL.replace(PASSWORD, pw) }],
    ];
    for (const [target, env] of cases) {
      const r = run(["--target", target, file], env);
      expect(r.status, target).toBe(1);
      expect(r.output).toMatch(/::error::/);
      expect(r.output).not.toContain("Hunter");
      expect(r.log).toEqual([]);
    }
  });

  it("refuses an unknown target, a missing one, and a repeated or contradictory flag", () => {
    expect(run(["--target", "prod", file], { BIS_MIGRATIONS_DB_URL: LOCAL }).status).toBe(2);
    expect(run([file], { BIS_MIGRATIONS_DB_URL: LOCAL }).status).toBe(2);
    expect(run(["--target", "local-as-bis-ci", "--target", "bis-ci", file], { BIS_MIGRATIONS_DB_URL: LOCAL }).status).toBe(2);
    expect(run(["--target", "local-as-bis-ci", "--check", "--dry-run", file], { BIS_MIGRATIONS_DB_URL: LOCAL }).status).toBe(2);
    expect(run(["--target", "local-as-bis-ci", "--dry-run", "--dry-run", file], { BIS_MIGRATIONS_DB_URL: LOCAL }).status).toBe(2);
  });

  it("hands psql no PG* variable from its environment: the URL is the whole connection", () => {
    const r = run(["--target", "local-as-bis-ci", "--dry-run", file], { ...asLocalBisCi(""), PGHOST: "db.example.com", PGOPTIONS: "-c default_transaction_read_only=off" });
    expect(r.status, r.output).toBe(0);
    expect(r.log[0]).toContain("PGHOST= PGOPTIONS=");
  });

  it("keeps the password off psql's command line (what `ps` shows), handing it over in PGPASSWORD", () => {
    const r = run(["--target", "local-as-bis-ci", "--dry-run", file], asLocalBisCi(""));
    expect(r.status, r.output).toBe(0);
    expect(r.log.join("\n")).not.toContain(PASSWORD);
    expect(r.log[0]).toContain("PGPASSWORD=set");
  });

  it("requires TLS (PGSSLMODE=require) for the hosted targets", () => {
    const r = run(["--target", "bis-ci", "--dry-run", file], { BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_DB_URL: pooler(CI_REF) });
    expect(r.status, r.output).toBe(0);
    expect(r.log[0]).toContain("PGSSLMODE=require");
    expect(r.log.join("\n")).not.toContain(PASSWORD);
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

  it("refuses a file that starts with a UTF-8 byte-order mark, saying so", () => {
    files({ [NEW]: "﻿create table t (id int);\n" });
    const r = run(["--target", "local-as-bis-ci", "--dry-run", `${DIR}/${NEW}`], asLocalBisCi(""));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114093000_work_queue\.sql starts with a UTF-8 byte-order mark/);
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

  it("refuses a file on main, recorded by this runner, whose content has changed since (mutation: skip main's files' digest compare → FAILS)", () => {
    files({ "20261114080000_other.sql": "select 1;\n", [NEW]: "select 2;\n" });
    const r = run(["--target", "local-as-bis-ci", "--dry-run", `${DIR}/${NEW}`],
      asLocalBisCi(rows(["20261114080000", "other", "0".repeat(32)])));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114080000_other\.sql has different content from what local-as-bis-ci recorded/);
  });

  it("succeeds when the history, read AGAIN after the apply, records the file with its content (mutation: drop the post-apply re-read → FAILS)", () => {
    files({ [NEW]: "select 4;\n" });
    const recorded = rows([NEW.slice(0, 14), "work_queue", md5(NEW)]);
    const r = run(["--target", "local-as-bis-ci", `${DIR}/${NEW}`], asLocalBisCi("", { FAKE_TARGET_ROWS_AFTER: recorded }));
    expect(r.output).not.toContain("::error::");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("applied 1 file(s)");
    // Read, apply, read again.
    expect(r.log.map((l) => (l.includes("[[-f]]") ? "apply" : "read"))).toEqual(["read", "apply", "read"]);
  });

  it("names the SQLSTATE of a connection-level FATAL too, and says nothing ran (mutation: count ERROR lines only → FAILS)", () => {
    files({ [NEW]: "select 4;\n" });
    const r = run(["--target", "local-as-bis-ci", `${DIR}/${NEW}`],
      asLocalBisCi("", { FAKE_APPLY_EXIT: "2", FAKE_APPLY_STDERR: "psql: error: connection to server failed: FATAL:  28P01" }));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114093000_work_queue\.sql failed \(SQLSTATE 28P01\) and was rolled back/);
  });

  it("hands psql neither URL variable: psql reads only the connection string and PGPASSWORD", () => {
    files({ [NEW]: "select 4;\n" });
    const r = run(["--target", "local-as-production", "--dry-run", `${DIR}/${NEW}`],
      asLocalProd("", rows([NEW.slice(0, 14), "work_queue", md5(NEW)])));
    expect(r.status, r.output).toBe(0);
    expect(r.log.length).toBeGreaterThan(0);
    for (const line of r.log) expect(line).toMatch(/ URLS=$/);
  });

  it("fails when the file ran but the history does not record it afterwards (mutation: drop the post-apply re-read → FAILS)", () => {
    files({ [NEW]: "select 4;\n" });
    // psql "applies" (exit 0) but the history read after it still shows nothing.
    const r = run(["--target", "local-as-bis-ci", `${DIR}/${NEW}`], asLocalBisCi(""));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114093000_work_queue\.sql was run, but local-as-bis-ci does not record it/);
    expect(r.log.some((l) => l.includes("[[-f]]"))).toBe(true);
    expect(r.log.join("\n")).not.toContain(PASSWORD);
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

// Review of #369 (2026-11-13): ci-project-setup.yml's rebuild-push runs the
// Supabase CLI's `db push`, which writes history rows the runner cannot
// compare. It is for a rebuilt, EMPTY project only, so the dispatch first
// asks the runner, read-only, whether bis-ci's history is absent or empty, and
// refuses a live project, pointing at `apply`.
describe("migrations-apply.sh --require-empty: rebuild-push runs only on an empty project", () => {
  it("passes when the history table is absent or empty, in one read-only transaction, writing nothing", () => {
    const r = run(["--target", "local-as-bis-ci", "--require-empty"], asLocalBisCi("0\n"));
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/history is empty or absent: a rebuild may push/);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatch(/begin transaction read only;.*to_regclass\('supabase_migrations\.schema_migrations'\) is null then 0/);
    expect(r.log[0]).not.toContain("[[-f]]");
  });

  it("refuses a project whose history holds rows, saying to use apply (mutation: pass any count → FAILS)", () => {
    const r = run(["--target", "local-as-bis-ci", "--require-empty"], asLocalBisCi("117\n"));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::.*history holds 117 row\(s\): rebuild-push is for a rebuilt, EMPTY project only.*apply-dry-run then apply/);
  });

  it.each([
    ["a read that fails", { FAKE_PSQL_EXIT: "2" }, /::error::Could not read/],
    ["an answer that is not a count", { FAKE_TARGET_ROWS: "oops" }, /::error::.*not a row count/],
    ["an empty answer", { FAKE_TARGET_ROWS: "" }, /::error::.*not a row count/],
  ])("fails closed on %s, never reading it as empty", (_label, extra, pattern) => {
    const r = run(["--target", "local-as-bis-ci", "--require-empty"], { ...asLocalBisCi("0\n"), ...extra });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(pattern);
  });

  it("takes no files beside it", () => {
    const r = run(["--target", "local-as-bis-ci", "--require-empty", `${DIR}/${NEW}`], asLocalBisCi("0\n"));
    expect(r.status, r.output).toBe(2);
  });
});

// PR 5 (2026-11-13): production's step. The secret lives only in the
// production-migrations environment, which the owner creates by hand; until
// then (or if it is ever deleted) the job's step receives an empty value, and
// the runner must say which secret is missing and where it belongs.
describe("migrations-apply.sh --target production with no production secret", () => {
  it("refuses, naming PROD_MIGRATIONS_DB_URL and the production-migrations environment, and reads nothing (mutation: drop the production branch of the empty-URL message → FAILS)", () => {
    files({ [NEW]: "select 1;\n" });
    const r = run(["--target", "production", `${DIR}/${NEW}`], { GITHUB_ACTIONS: "true", BIS_MIGRATIONS_DB_URL: "", BIS_CI_SUPABASE_REF: CI_REF, BIS_MIGRATIONS_BISCI_DB_URL: pooler(CI_REF) });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::PROD_MIGRATIONS_DB_URL is not set: it is a secret of the production-migrations environment only/);
    expect(r.output).toContain("Nothing was read or applied.");
    expect(r.log).toEqual([]);
  });
});

// D4: parity, after every production apply. fingerprint-detail.sql is read
// on production and on bis-ci (fake psql answers with FAKE_TARGET_FP and
// FAKE_BISCI_FP: `kind SEP key SEP digest of the definition` lines), the
// differences are compared by KEY, the allowed list is subtracted, and only
// keys are printed. The histories are compared NORMALISED first: each row
// maps to the file it covers by D1's rule, so production's slug-only and stem
// rows equal bis-ci's pairs for the same files.
describe("migrations-apply.sh --parity compares production with bis-ci (D4)", () => {
  const PARITY_DIR = "packages/db/supabase/parity";
  const LEGACY = "0001_tenancy.sql";
  const LEGACY2 = "0060_owner_line.sql";
  const DETAIL = fs.readFileSync(path.join(REPO, PARITY_DIR, "fingerprint-detail.sql"), "utf8");
  const ALLOWED = [
    "# kind | key | why (every line needs its reason)",
    "extension_version(info) | * | the platform upgrades extensions on its own schedule",
    "function | app.current_account_id() | re-indented by the MCP apply",
    "history | 0048_accounts_mailing_address_check_escapes | a hand repair recorded on production only",
    "",
  ].join("\n");
  const fp = (...l: [string, string, string][]) => l.map(([k, key, d]) => `${k}${SEP}${key}${SEP}${d}\n`).join("");
  const BASE: [string, string, string][] = [
    ["column", "public.contacts.email", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["function", "public.concierge_enable(p_account_id uuid)", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    ["relation", "public.contacts", "cccccccccccccccccccccccccccccccc"],
  ];
  const setup = (allowed = ALLOWED, detail = DETAIL) => {
    files({ [LEGACY]: "select 1;\n", [LEGACY2]: "select 2;\n", [NEW]: "select 3;\n" });
    fs.mkdirSync(path.join(tree, PARITY_DIR), { recursive: true });
    fs.writeFileSync(path.join(tree, PARITY_DIR, "fingerprint-detail.sql"), detail);
    fs.rmSync(path.join(tree, PARITY_DIR, "allowed-differences.txt"), { force: true });
    if (allowed !== "") fs.writeFileSync(path.join(tree, PARITY_DIR, "allowed-differences.txt"), allowed);
  };
  // bis-ci: every row the runner or the CLI wrote, as pairs. Production: 0001
  // as the CLI's pair, 0060 slug-only at its apply time, the new file as the
  // runner's pair (A3's shapes).
  const bisci = () => rows(["0001", "tenancy"], ["0060", "owner_line"], ["20261114093000", "work_queue", md5(NEW)]);
  const prod = (...extra: [string, string, string?][]) =>
    rows(["0001", "tenancy"], ["20261111035059", "owner_line"], ["20261114093000", "work_queue", md5(NEW)], ...extra);
  const parity = (target: string, b: string, tfp: string, bfp: string, extra: Record<string, string | undefined> = {}) =>
    run(["--target", "local-as-production", "--parity", `${DIR}/${NEW}`], asLocalProd(target, b, { FAKE_TARGET_FP: tfp, FAKE_BISCI_FP: bfp, ...extra }));

  it("passes when the normalised histories and every item match: production's slug-only row equals bis-ci's pair for the same file", () => {
    setup();
    const r = parity(prod(), bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("Parity: production matches bis-ci");
    // Both reads are ONE read-only transaction sent as one command, with a lock timeout.
    // (A multi-line query spans log lines, so calls are split on the fake's own "psql " prefix.)
    const reads = r.log.join("\n").split(/^psql /m).filter((c) => c.includes("from items"));
    expect(reads).toHaveLength(2);
    for (const l of reads) expect(l).toMatch(/\[\[begin transaction read only; set local lock_timeout = '5s';/);
    // M5: both sides hash each definition, so none is ever printed.
    for (const l of reads) expect(l).toContain("select kind, key, coalesce(md5(def), '-') from items");
  });

  it("fails on an extra column on production, naming its kind and key and never its definition (mutation: always pass → FAILS)", () => {
    setup();
    const r = parity(prod(), bisci(), fp(...BASE, ["column", "public.contacts.secret_note", "dddddddddddddddddddddddddddddddd"]), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::Parity: production and bis-ci differ/);
    expect(r.output).toContain("column public.contacts.secret_note (production only)");
    expect(r.output).not.toContain("dddddddddddddddd");
  });

  it("fails on a function that only bis-ci has (mutation: make parity ignore the function kind → FAILS)", () => {
    setup();
    const r = parity(prod(), bisci(), fp(...BASE), fp(...BASE, ["function", "public.new_rpc(p uuid)", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain("function public.new_rpc(p uuid) (bis-ci only)");
  });

  it("fails on an item whose definition differs, naming it as different on both", () => {
    setup();
    const changed = BASE.map(([k, key, d]): [string, string, string] => (k === "relation" ? [k, key, "ffffffffffffffffffffffffffffffff"] : [k, key, d]));
    const r = parity(prod(), bisci(), fp(...changed), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain("relation public.contacts (differs)");
    expect(r.output).not.toContain("ffffffffffffffff");
  });

  it("passes when the only differences are allowed: a listed key, and a kind listed with * (mutation: ignore the allowed list → FAILS)", () => {
    setup();
    const t = fp(...BASE, ["function", "app.current_account_id()", "11111111111111111111111111111111"], ["extension_version(info)", "pg_trgm", "1.6"]);
    const b = fp(...BASE, ["function", "app.current_account_id()", "22222222222222222222222222222222"], ["extension_version(info)", "pg_trgm", "1.5"]);
    const r = parity(prod(), bisci(), t, b);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("allowed: function app.current_account_id()");
  });

  it("does not judge the schema when the histories differ (another PR is between bis-ci and production): a notice naming the migration, and a pass", () => {
    setup();
    const b = bisci() + rows(["20261115000000", "other_branch", "0123456789abcdef0123456789abcdef"]);
    const r = parity(prod(), b, fp(...BASE, ["column", "public.x.y", "dddddddddddddddddddddddddddddddd"]), fp(...BASE));
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/::notice::Parity not judged: bis-ci holds/);
    expect(r.output).toContain("20261115000000_other_branch (bis-ci only)");
    expect(r.log.filter((l) => l.includes("from items"))).toHaveLength(0);
  });

  it("treats a history row listed as allowed as absent, so production's extra hand-repair row does not stop the judgement (mutation: drop the history kind → FAILS)", () => {
    setup();
    const r = parity(prod(["20260925000000", "0048_accounts_mailing_address_check_escapes"]), bisci(), fp(...BASE, ["column", "public.x.y", "dddddddddddddddddddddddddddddddd"]), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain("column public.x.y (production only)");
  });

  it("fails when a newly applied file's recorded content differs between the file, bis-ci and production, even when histories differ", () => {
    setup();
    const p = rows(["0001", "tenancy"], ["20261111035059", "owner_line"], ["20261114093000", "work_queue", "0".repeat(32)]);
    const r = parity(p, bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain(`${DIR}/${NEW} was applied to local-as-production with different content`);
  });

  it("fails when bis-ci's recorded copy of a newly applied file differs from the file (mutation: skip the bis-ci side of the digest check → FAILS)", () => {
    setup();
    const b = rows(["0001", "tenancy"], ["0060", "owner_line"], ["20261114093000", "work_queue", "0".repeat(32)]);
    const r = parity(prod(), b, fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain(`${DIR}/${NEW} is not recorded with the file's content on bis-ci`);
  });

  it("fails closed when a fingerprint cannot be read", () => {
    setup();
    const r = parity(prod(), bisci(), fp(...BASE), fp(...BASE), { FAKE_FP_EXIT: "2" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::Could not read the production fingerprint/);
  });

  it("fails closed on an empty fingerprint: an empty read is not a match", () => {
    setup();
    const r = parity(prod(), bisci(), "", "");
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::The production fingerprint came back empty/);
  });

  it("refuses an allowed-differences line with no reason, and a missing list", () => {
    setup("column | public.contacts.email |\n");
    let r = parity(prod(), bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/allowed-differences\.txt line 1 has no reason/);
    setup("");
    r = parity(prod(), bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/allowed-differences\.txt is missing/);
  });

  it("refuses when fingerprint-detail.sql's final select is not the one it hashes", () => {
    setup(ALLOWED, DETAIL.replace("select kind, key, def from items", "select kind, key, def, 1 from items"));
    const r = parity(prod(), bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/fingerprint-detail\.sql no longer ends in the select parity hashes/);
  });

  it("runs only with production's rules", () => {
    setup();
    const r = run(["--target", "local-as-bis-ci", "--parity", `${DIR}/${NEW}`], asLocalBisCi(bisci()));
    expect(r.status, r.output).toBe(2);
  });

  // Review of #370, item 1: drift on PRODUCTION is never "another PR in flight".
  it("FAILS when production holds a history row bis-ci lacks (a hand fix on production is drift), naming the stem (mutation: treat production-only rows like bis-ci-only → FAILS)", () => {
    setup();
    const r = parity(prod(["20261112000000", "hand_fix"]), bisci(), fp(...BASE, ["column", "public.x.y", "dddddddddddddddddddddddddddddddd"]), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::Parity: production holds 20261112000000_hand_fix that bis-ci does not: drift/);
    expect(r.log.join("\n")).not.toContain("from items");
  });

  // Item 2: a bis-ci-only row (an in-flight or abandoned PR) skips the
  // judgement, and the notice says it will keep doing so until resolved.
  it("a bis-ci-only row skips the judgement with a notice that says it persists until the row is allowed or reaches production", () => {
    setup();
    const b = bisci() + rows(["20261115000000", "other_branch", "0123456789abcdef0123456789abcdef"]);
    const r = parity(prod(), b, fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/every apply until each row above is listed in packages\/db\/supabase\/parity\/allowed-differences\.txt \(`history \| <stem> \| reason`\) or its migration reaches production/);
  });

  it("an orphan bis-ci row listed by its stem as `history` no longer stops the judgement (mutation: match history lines on the row's name only → FAILS)", () => {
    setup(`${ALLOWED}history | 20261115000000_other_branch | PR closed unmerged; reverted by a later migration\n`);
    const b = bisci() + rows(["20261115000000", "other_branch", "0123456789abcdef0123456789abcdef"]);
    const r = parity(prod(), b, fp(...BASE, ["column", "public.x.y", "dddddddddddddddddddddddddddddddd"]), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain("column public.x.y (production only)");
  });

  // Item 3: the documented MCP fallback leaves a whole-stem row on production
  // with no runner digest. It is accepted only when bis-ci's recorded digest
  // equals the file AND parity is judged and passes.
  const prodHand = () => rows(["0001", "tenancy"], ["20261111035059", "owner_line"], ["20261114120000", "20261114093000_work_queue"]);

  it("accepts a file applied to production BY HAND (whole-stem row, no digest) when bis-ci's copy matches and parity passes, saying so (mutation: refuse every row without a digest → FAILS)", () => {
    setup();
    const r = parity(prodHand(), bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/::notice::.*20261114093000_work_queue\.sql was applied to production by hand/);
    expect(r.output).toContain("Parity: production matches bis-ci");
  });

  it("a hand-applied file is still judged: an extra column fails", () => {
    setup();
    const r = parity(prodHand(), bisci(), fp(...BASE, ["column", "public.x.y", "dddddddddddddddddddddddddddddddd"]), fp(...BASE));
    expect(r.status, r.output).toBe(1);
  });

  it("refuses a hand-applied file when bis-ci's recorded copy differs from the file", () => {
    setup();
    const b = rows(["0001", "tenancy"], ["0060", "owner_line"], ["20261114093000", "work_queue", "0".repeat(32)]);
    const r = parity(prodHand(), b, fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain(`${DIR}/${NEW} is not recorded with the file's content on bis-ci`);
  });

  it("refuses a hand-applied file when parity cannot be judged: nothing then vouches for its content (mutation: accept it on the notice path → FAILS)", () => {
    setup();
    const b = bisci() + rows(["20261115000000", "other_branch", "0123456789abcdef0123456789abcdef"]);
    const r = parity(prodHand(), b, fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::.*20261114093000_work_queue\.sql was applied to production by hand, and parity could not be judged/);
  });

  // Item 4 (M8): only parity's production-side content check can catch a
  // pair row with no runner digest (a CLI push, say): the runner's earlier
  // loops treat a digest-less row as applied.
  it("refuses a production pair row that carries no content digest: only parity's production-side check sees it (mutation: drop that check → FAILS)", () => {
    setup();
    const p = rows(["0001", "tenancy"], ["20261111035059", "owner_line"], ["20261114093000", "work_queue"]);
    const r = parity(p, bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain(`${DIR}/${NEW} is not recorded with the file's content on production`);
  });

  it("parses the repository's own allowed-differences.txt: every line has a kind, a key and a reason", () => {
    setup(fs.readFileSync(path.join(REPO, PARITY_DIR, "allowed-differences.txt"), "utf8"));
    const r = parity(prod(), bisci(), fp(...BASE), fp(...BASE));
    expect(r.status, r.output).toBe(0);
  });
});
