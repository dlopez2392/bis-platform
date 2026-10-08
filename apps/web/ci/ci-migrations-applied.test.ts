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
const DB_PASSWORD = "UnitTestCiPoolerPassword_6a2e";
const DB_URL = `postgresql://postgres.cirefcirefcirefciref:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

const FAKE_PSQL = `#!/usr/bin/env bash
printf 'psql %s\\n' "$*" >> "$FAKE_DIR/log"
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

/** `applied` is what bis-ci's history holds, one version per line, as `psql -tA` prints it. */
function run(applied: string[], extraEnv: Record<string, string | undefined> = {}): Run {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${path.join(fakeDir, "bin")}${path.delimiter}${env[pathKey] ?? ""}`;
  Object.assign(env, {
    FAKE_DIR: toBashPath(fakeDir),
    FAKE_APPLIED: applied.map((v) => `${v}\n`).join(""),
    SUPABASE_DB_URL: DB_URL,
  });
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(bash, [SCRIPT], { env, encoding: "utf8", cwd: REPO });
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

  it("passes when bis-ci holds every one, and reads the CLI's own history table with the CI project's DB URL", () => {
    const r = run(VERSIONS);
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toContain("supabase_migrations.schema_migrations");
    expect(r.log[0]).toContain(DB_URL);
  });

  it("fails naming EACH missing migration file, and only those, with the fix (mutation: exit 0 whatever is missing → FAILS)", () => {
    const first = MIGRATION_FILES[0]!;
    const last = MIGRATION_FILES[MIGRATION_FILES.length - 1]!;
    const r = run(VERSIONS.slice(1, -1));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${first.replace(".", "\\.")}`));
    expect(r.output).toMatch(new RegExp(`::error::.*${last.replace(".", "\\.")}`));
    expect(r.output).not.toContain(MIGRATION_FILES[1]!);
    expect(r.output).toContain("ci-project-setup.yml");
    expect(r.output).toContain("docs/runbooks/ci-supabase-project.md");
  });

  it("does NOT fail when bis-ci holds migrations this branch lacks: another branch applied first (mutation: also fail on extra rows → FAILS)", () => {
    const r = run([...VERSIONS, "9998", "9999"]);
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
  });

  it("treats an empty history as every migration missing, never as nothing to check", () => {
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(MIGRATION_FILES[0]!);
  });

  it("tolerates the whitespace and carriage returns psql can print around a version", () => {
    const r = run(VERSIONS.map((v) => ` ${v}\r`));
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
  });

  it("fails, loudly, when it cannot read bis-ci's history at all: a gate that cannot check is red, not skipped (mutation: `|| true` on the psql read → FAILS)", () => {
    const r = run(VERSIONS, { FAKE_PSQL_EXIT: "2", FAKE_PSQL_STDERR: "psql: error: connection refused" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*could not read/i);
  });

  it("refuses to run without SUPABASE_DB_URL, naming it, and never calls psql", () => {
    const r = run(VERSIONS, { SUPABASE_DB_URL: undefined });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL/);
    expect(r.log).toEqual([]);
  });
});
