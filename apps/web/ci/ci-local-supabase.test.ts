import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// verify's database is a throwaway Supabase stack started inside its own
// runner by two scripts in .github/scripts/:
//
//   ci-supabase-cli.sh    installs the Supabase CLI at ONE pinned version,
//                         refusing a download whose sha256 is not the pinned one;
//   ci-local-supabase.sh  starts the stack with NO migrations, applies the CI
//                         project's bootstrap (default privileges, the
//                         brand-logos bucket), THEN pushes the migrations with
//                         the same `supabase db push` the CI project got, and
//                         writes the stack's four values to GITHUB_ENV.
//
// The order is the point. Grants attach when a table is CREATED, and the CLI
// starts every local stack with default privileges that grant the Data API
// roles nothing (config.toml, the "auto-expose" note). Migrations applied by
// `supabase start` itself would land BEFORE the bootstrap and every grant-
// pinning test in the db suite would see a different database from the CI
// project and production. So the stack starts from a workdir whose
// migrations folder is empty, and the migrations come after the bootstrap.
//
// Both scripts are run for real, through bash, with fake `supabase`, `psql`
// and `curl` first on PATH that log how they were called. No case here
// starts a container, reaches a network or needs Docker (the dev machine has
// none; CI is where the real stack is proven).

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const toBashPath = (p: string) => p.replace(/\\/g, "/");
const STACK_SCRIPT = toBashPath(path.join(REPO, ".github/scripts/ci-local-supabase.sh"));
const CLI_SCRIPT = toBashPath(path.join(REPO, ".github/scripts/ci-supabase-cli.sh"));

const SERVICE_KEY = "eyJUNIT.TEST.SERVICE_ROLE_JWT_a41f";
const ANON_KEY = "eyJUNIT.TEST.ANON_JWT_77b0";
const DB_PASSWORD = "UnitTestStackPassword_0d3c";
const DB_URL = `postgresql://postgres:${DB_PASSWORD}@127.0.0.1:54322/postgres`;
const API_URL = "http://127.0.0.1:54321";

/** What `supabase status -o env` prints, quoted the way the CLI quotes it. */
function statusEnv(drop: string[] = []): string {
  const all: Record<string, string> = {
    API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY: SERVICE_KEY,
    GRAPHQL_URL: `${API_URL}/graphql/v1`, JWT_SECRET: "super-secret-jwt-token-with-at-least-32-characters-long",
  };
  return Object.entries(all)
    .filter(([k]) => !drop.includes(k))
    .map(([k, v]) => `${k}="${v}"`)
    .join("\n") + "\n";
}

const FAKE_SUPABASE = `#!/usr/bin/env bash
log() { printf '%s\\n' "$*" >> "$FAKE_DIR/log"; }
case "$1" in
  start)
    wd=""; prev=""
    for a in "$@"; do [ "$prev" = "--workdir" ] && wd="$a"; prev="$a"; done
    n=$(ls -A "$wd/supabase/migrations" 2>/dev/null | wc -l | tr -d ' ')
    cfg=no; [ -f "$wd/supabase/config.toml" ] && cfg=yes
    log "supabase $* [migrations=$n config=$cfg]"
    exit "\${FAKE_START_EXIT:-0}" ;;
  status)
    log "supabase $*"
    printf '%s' "$FAKE_STATUS"
    exit 0 ;;
  *)
    log "supabase $*"
    exit "\${FAKE_PUSH_EXIT:-0}" ;;
esac
`;

const FAKE_PSQL = `#!/usr/bin/env bash
printf 'psql %s\\n' "$*" >> "$FAKE_DIR/log"
for a in "$@"; do
  case "$a" in
    *server_version_num*) printf '%s\\n' "\${FAKE_PG_VERSION_NUM:-170006}" ;;
    -f) exit "\${FAKE_PSQL_FILE_EXIT:-0}" ;;
  esac
done
exit 0
`;

// Writes whatever FAKE_CURL_BODY says to the file named by -o, and logs argv.
const FAKE_CURL = `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "$FAKE_DIR/log"
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
[ -n "$out" ] && printf '%s' "\${FAKE_CURL_BODY:-not the release}" > "$out"
exit 0
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
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-local-supabase-"));
  fs.mkdirSync(path.join(fakeDir, "bin"));
  for (const [name, body] of [["supabase", FAKE_SUPABASE], ["psql", FAKE_PSQL], ["curl", FAKE_CURL]] as const) {
    fs.writeFileSync(path.join(fakeDir, "bin", name), body, { mode: 0o755 });
  }
  bash = bashExecutable();
  const warm = spawnSync(bash, ["-c", ":"], { encoding: "utf8" });
  if (warm.error) throw warm.error;
}, 60_000);

afterAll(() => {
  fs.rmSync(fakeDir, { recursive: true, force: true });
});

let runnerTemp = "";
beforeEach(() => {
  fs.rmSync(path.join(fakeDir, "log"), { force: true });
  runnerTemp = fs.mkdtempSync(path.join(fakeDir, "runner-temp-"));
});

type Run = { status: number | null; output: string; log: string[]; githubEnv: string; githubPath: string };

function run(script: string, extraEnv: Record<string, string> = {}): Run {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"]) {
    delete env[name];
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${path.join(fakeDir, "bin")}${path.delimiter}${env[pathKey] ?? ""}`;
  const githubEnv = path.join(runnerTemp, "github_env");
  const githubPath = path.join(runnerTemp, "github_path");
  fs.writeFileSync(githubEnv, "");
  fs.writeFileSync(githubPath, "");
  Object.assign(env, {
    FAKE_DIR: toBashPath(fakeDir),
    FAKE_STATUS: statusEnv(),
    RUNNER_TEMP: toBashPath(runnerTemp),
    GITHUB_ENV: toBashPath(githubEnv),
    GITHUB_PATH: toBashPath(githubPath),
    ...extraEnv,
  });
  const r = spawnSync(bash, [script], { env, encoding: "utf8", cwd: REPO });
  if (r.error) throw r.error;
  const logFile = path.join(fakeDir, "log");
  const output = `${r.stdout}${r.stderr}`;
  // No case may print the stack's service key or DB password.
  expect(output.includes(SERVICE_KEY), "printed the service key").toBe(false);
  expect(output.includes(DB_PASSWORD), "printed the DB password").toBe(false);
  return {
    status: r.status,
    output,
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [],
    githubEnv: fs.readFileSync(githubEnv, "utf8"),
    githubPath: fs.readFileSync(githubPath, "utf8"),
  };
}

const indexOf = (log: string[], re: RegExp) => log.findIndex((l) => re.test(l));
const BOOTSTRAP = /^psql .* -f packages\/db\/supabase\/bootstrap\/ci-project\.sql/;
const PUSH = /^supabase db push --local --workdir packages\/db --yes$/;

describe("ci-local-supabase.sh: a stack whose schema is built in the CI project's order", () => {
  it("starts the stack from a workdir holding the repo's config.toml and NO migrations (mutation: start from packages/db → migrations=60, FAILS)", () => {
    const r = run(STACK_SCRIPT);
    expect(r.status, r.output).toBe(0);
    const start = r.log.find((l) => l.startsWith("supabase start "));
    expect(start).toMatch(/\[migrations=0 config=yes\]$/);
    expect(start).not.toMatch(/--workdir packages\/db\b/);
  });

  it("applies the bootstrap BEFORE the migrations, and both after the stack is up (mutation: swap the two → FAILS)", () => {
    const r = run(STACK_SCRIPT);
    expect(r.status, r.output).toBe(0);
    const start = indexOf(r.log, /^supabase start /);
    const bootstrap = indexOf(r.log, BOOTSTRAP);
    const push = indexOf(r.log, PUSH);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(bootstrap).toBeGreaterThan(start);
    expect(push).toBeGreaterThan(bootstrap);
  });

  it("applies the bootstrap as ONE transaction that stops at the first error, as ci:sql does on the CI project", () => {
    const r = run(STACK_SCRIPT);
    const line = r.log.find((l) => BOOTSTRAP.test(l)) ?? "";
    expect(line).toContain("--single-transaction");
    expect(line).toContain("ON_ERROR_STOP=1");
    expect(line).toContain(DB_URL);
  });

  it("keeps the database, the gateway, PostgREST and Storage (demo-seed.test.ts uploads a logo) and excludes only services no suite reaches", () => {
    const r = run(STACK_SCRIPT);
    const start = r.log.find((l) => l.startsWith("supabase start ")) ?? "";
    const excluded = /--exclude (\S+)/.exec(start)?.[1]?.split(",") ?? [];
    expect(excluded.length).toBeGreaterThan(0);
    for (const kept of ["kong", "postgrest", "storage-api"]) expect(excluded).not.toContain(kept);
    expect(excluded).toEqual(expect.arrayContaining(["studio", "realtime", "edge-runtime"]));
  });

  it("writes exactly the four values the code reads to GITHUB_ENV, mapped from the stack's own status", () => {
    const r = run(STACK_SCRIPT);
    expect(r.status, r.output).toBe(0);
    expect(r.githubEnv.trim().split("\n").sort()).toEqual([
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}`,
      `NEXT_PUBLIC_SUPABASE_URL=${API_URL}`,
      `SUPABASE_DB_URL=${DB_URL}`,
      `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}`,
    ]);
  });
});

describe("ci-local-supabase.sh: every failure is loud, and leaves verify no values to run on", () => {
  it.each(["API_URL", "DB_URL", "ANON_KEY", "SERVICE_ROLE_KEY"])("refuses a status without %s, naming it, before anything is applied", (name) => {
    const r = run(STACK_SCRIPT, { FAKE_STATUS: statusEnv([name]) });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(new RegExp(`::error::.*${name}`));
    expect(indexOf(r.log, BOOTSTRAP)).toBe(-1);
    expect(indexOf(r.log, PUSH)).toBe(-1);
    expect(r.githubEnv).toBe("");
  });

  it("refuses a Postgres major that is not config.toml's major_version, naming both, before anything is applied", () => {
    const r = run(STACK_SCRIPT, { FAKE_PG_VERSION_NUM: "150008" });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/::error::.*Postgres 15.*17/);
    expect(indexOf(r.log, BOOTSTRAP)).toBe(-1);
    expect(r.githubEnv).toBe("");
  });

  it("stops when `supabase start` fails", () => {
    const r = run(STACK_SCRIPT, { FAKE_START_EXIT: "1" });
    expect(r.status).not.toBe(0);
    expect(indexOf(r.log, BOOTSTRAP)).toBe(-1);
    expect(r.githubEnv).toBe("");
  });

  it("never pushes the migrations when the bootstrap fails", () => {
    const r = run(STACK_SCRIPT, { FAKE_PSQL_FILE_EXIT: "3" });
    expect(r.status).not.toBe(0);
    expect(indexOf(r.log, PUSH)).toBe(-1);
    expect(r.githubEnv).toBe("");
  });

  it("writes nothing to GITHUB_ENV when the push fails", () => {
    const r = run(STACK_SCRIPT, { FAKE_PUSH_EXIT: "1" });
    expect(r.status).not.toBe(0);
    expect(r.githubEnv).toBe("");
  });
});

describe("ci-supabase-cli.sh: one pinned CLI, checked before it runs", () => {
  const script = fs.readFileSync(path.join(REPO, ".github/scripts/ci-supabase-cli.sh"), "utf8");
  const pinnedVersion = /^SUPABASE_CLI_VERSION="([^"]+)"$/m.exec(script)?.[1];
  const pinnedSha = /^SUPABASE_CLI_SHA256="([^"]+)"$/m.exec(script)?.[1];

  it("pins the same CLI version as the lockfile's `supabase` devDependency, so the repo has one CLI (mutation: bump the script alone → FAILS)", () => {
    const lock = fs.readFileSync(path.join(REPO, "pnpm-lock.yaml"), "utf8");
    const locked = [...new Set([...lock.matchAll(/^ {2}supabase@(\d+\.\d+\.\d+):$/gm)].map((m) => m[1]))];
    expect(locked).toHaveLength(1);
    expect(pinnedVersion).toBe(locked[0]);
    expect(pinnedSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("downloads exactly that version's linux_amd64 release from the supabase/cli repository", () => {
    const r = run(CLI_SCRIPT);
    const curl = r.log.find((l) => l.startsWith("curl ")) ?? "";
    expect(curl).toContain(
      `https://github.com/supabase/cli/releases/download/v${pinnedVersion}/supabase_${pinnedVersion}_linux_amd64.tar.gz`);
  });

  it("refuses a download whose sha256 is not the pinned one, and puts nothing on PATH (mutation: drop the checksum check → FAILS)", () => {
    const r = run(CLI_SCRIPT, { FAKE_CURL_BODY: "a tampered or truncated tarball" });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/::error::.*sha256/);
    expect(r.githubPath).toBe("");
  });
});
