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
    [ "$cfg" = yes ] && cp "$wd/supabase/config.toml" "$FAKE_DIR/started-config.toml"
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

// Logs argv; answers a read of Kong's admin API (port 8001) with FAKE_KONG_ADMIN,
// and `docker inspect` (a container's environment) with FAKE_REST_ENV.
const FAKE_DOCKER = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$FAKE_DIR/log"
case "$*" in
  *8001*) printf '%s' "$FAKE_KONG_ADMIN" ;;
  inspect*) printf '%s' "$FAKE_REST_ENV" ;;
esac
exit "\${FAKE_DOCKER_EXIT:-0}"
`;
const KONG_ADMIN = (pool: number) =>
  `{"version":"2.8.1","configuration":{"upstream_keepalive_idle_timeout":60,"upstream_keepalive_pool_size":${pool},"upstream_keepalive_max_requests":100}}`;

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
  for (const [name, body] of [
    ["supabase", FAKE_SUPABASE], ["psql", FAKE_PSQL], ["curl", FAKE_CURL], ["docker", FAKE_DOCKER],
  ] as const) {
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
  fs.rmSync(path.join(fakeDir, "started-config.toml"), { force: true });
  runnerTemp = fs.mkdtempSync(path.join(fakeDir, "runner-temp-"));
});

/**
 * A development instance's publishable key: `pk_test_` + base64 of its
 * Frontend API domain and a `$`, which is how Clerk builds one (the e2e job's
 * real key decodes to `topical-redfish-40.clerk.accounts.dev$`).
 */
const clerkKey = (decoded: string, prefix = "pk_test_") =>
  `${prefix}${Buffer.from(decoded).toString("base64").replace(/=+$/, "")}`;
const CLERK_DOMAIN = "unit-test-41.clerk.accounts.dev";
const CLERK_PK = clerkKey(`${CLERK_DOMAIN}$`);
const TRUST_CLERK = "--trust-clerk-dev-instance";

/**
 * PostgREST's environment as `docker inspect` lists it. CLI 2.109.1 hands
 * PostgREST ONE JWKS (PGRST_JWT_SECRET): the third-party issuer's keys, fetched
 * at `supabase start`, followed by the stack's own HS256 secret as an `oct`
 * key (pkg/config ResolveJWKS). Without a third-party issuer only the `oct`
 * key is there.
 */
const OCT_KEY = `{"kty":"oct","k":"c3VwZXItc2VjcmV0"}`;
const RSA_KEY = `{"use":"sig","kty":"RSA","kid":"ins_unit_test","alg":"RS256","n":"xyz","e":"AQAB"}`;
const restEnv = (keys: string[]) =>
  `PGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET={"keys":[${keys.join(",")}]}\nPGRST_ADMIN_SERVER_PORT=3001\n`;

type Run = {
  status: number | null; output: string; log: string[]; githubEnv: string; githubPath: string;
  /** The config.toml the stack was started with, or "" if it never started. */
  startedConfig: string;
};

function run(script: string, extraEnv: Record<string, string> = {}, args: string[] = []): Run {
  // Per run, not per case: a case that runs the script twice must not read
  // the first run's calls as the second's.
  fs.rmSync(path.join(fakeDir, "log"), { force: true });
  fs.rmSync(path.join(fakeDir, "started-config.toml"), { force: true });
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ]) {
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
    FAKE_KONG_ADMIN: KONG_ADMIN(0),
    FAKE_REST_ENV: restEnv([RSA_KEY, OCT_KEY]),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_PK,
    RUNNER_TEMP: toBashPath(runnerTemp),
    GITHUB_ENV: toBashPath(githubEnv),
    GITHUB_PATH: toBashPath(githubPath),
    ...extraEnv,
  });
  const r = spawnSync(bash, [script, ...args], { env, encoding: "utf8", cwd: REPO });
  if (r.error) throw r.error;
  const logFile = path.join(fakeDir, "log");
  const startedFile = path.join(fakeDir, "started-config.toml");
  const output = `${r.stdout}${r.stderr}`;
  // No case may print the stack's service key or DB password, or the Clerk
  // key (a repository secret: GitHub would mask it, a derived string it would not).
  expect(output.includes(SERVICE_KEY), "printed the service key").toBe(false);
  expect(output.includes(DB_PASSWORD), "printed the DB password").toBe(false);
  expect(output.includes(String(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "\u0000")), "printed the Clerk key").toBe(false);
  return {
    status: r.status,
    output,
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [],
    githubEnv: fs.readFileSync(githubEnv, "utf8"),
    githubPath: fs.readFileSync(githubPath, "utf8"),
    startedConfig: fs.existsSync(startedFile) ? fs.readFileSync(startedFile, "utf8") : "",
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

  it("keeps the database, the gateway, PostgREST, Storage (demo-seed.test.ts uploads a logo) and auth, and excludes only services no suite reaches (mutation: exclude gotrue → FAILS)", () => {
    // gotrue stays although no suite signs in: CLI 2.109.1 prints no
    // ANON_KEY or SERVICE_ROLE_KEY in `status -o env` when it is excluded
    // (run 37813077940, 2026-10-08), and it costs no extra image pull — the
    // CLI pulls it anyway to initialise the auth schema.
    const r = run(STACK_SCRIPT);
    const start = r.log.find((l) => l.startsWith("supabase start ")) ?? "";
    const excluded = /--exclude (\S+)/.exec(start)?.[1]?.split(",") ?? [];
    expect(excluded.length).toBeGreaterThan(0);
    for (const kept of ["kong", "postgrest", "storage-api", "gotrue"]) expect(excluded).not.toContain(kept);
    expect(excluded).toEqual(expect.arrayContaining(["studio", "realtime", "edge-runtime"]));
  });

  // Run 37813770089 (2026-10-08): 1580 of 1581 db tests green, and one POST
  // answered by Kong's own 502, "An invalid response was received from the
  // upstream server". Kong 2.8.1 reuses an upstream connection for up to 60s
  // idle; PostgREST v14.14 (what CLI 2.109.1 runs) closes idle connections
  // sooner, and after a HEAD — every `{ count: 'exact', head: true }` —
  // closes without saying so. nginx retries a dead pooled connection only
  // for idempotent methods, so a POST or PATCH fails. [External: supabase/cli
  // issue #6674 and its thread; fixed upstream only in PostgREST v14.15,
  // i.e. CLI >= 2.110.0, which also moved the CLI's database commands to a
  // new implementation.] With no upstream keep-alive, no request ever lands
  // on a connection PostgREST already closed.
  it("turns Kong's upstream keep-alive off (pool size 0) and reloads it, after the stack starts and before anything is applied (mutation: drop the docker exec → FAILS)", () => {
    const r = run(STACK_SCRIPT);
    expect(r.status, r.output).toBe(0);
    const start = indexOf(r.log, /^supabase start /);
    const set = indexOf(r.log, /^docker exec supabase_kong_db .*upstream_keepalive_pool_size = 0.*kong reload/);
    const confirm = indexOf(r.log, /^docker exec supabase_kong_db .*127\.0\.0\.1:8001/);
    expect(set).toBeGreaterThan(start);
    expect(confirm).toBeGreaterThan(set);
    expect(indexOf(r.log, BOOTSTRAP)).toBeGreaterThan(confirm);
  });

  it("refuses to go on when the RUNNING Kong still reports a keep-alive pool, naming the setting, applying nothing (mutation: trust the file edit without reading the admin API → FAILS)", () => {
    const r = run(STACK_SCRIPT, { FAKE_KONG_ADMIN: KONG_ADMIN(60) });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/::error::.*upstream_keepalive_pool_size/);
    expect(indexOf(r.log, BOOTSTRAP)).toBe(-1);
    expect(r.githubEnv).toBe("");
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

/** The non-comment lines of config.toml's `[auth.third_party.clerk]` table. */
function clerkSection(toml: string): string[] {
  const lines = toml.replace(/\r\n/g, "\n").split("\n");
  const at = lines.indexOf("[auth.third_party.clerk]");
  if (at < 0) return [];
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => l.startsWith("["));
  return (end < 0 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

// The e2e job (2026-10-08) runs on its own stack too, and it signs in for
// real: every in-account page reads through userDb(), which sends the Clerk
// session token as the Bearer, and PostgREST must verify it. CLI 2.109.1 does
// that for a stack whose config.toml enables `[auth.third_party.clerk]`: at
// `supabase start` it fetches `https://<domain>/.well-known/openid-configuration`,
// then that document's jwks_uri, and hands PostgREST those keys plus the
// stack's own secret as one JWKS (PGRST_JWT_SECRET; pkg/config ResolveJWKS,
// internal/start). Kong passes any Bearer that is not an `sb_` key through
// untouched. [External: read from the supabase/cli source at tag v2.109.1.]
//
// The domain is the Clerk instance's Frontend API, which the publishable key
// carries (base64 of `<domain>$`), so the stack trusts exactly the instance
// the app signs in with. Only a development instance's domain is accepted.
describe("ci-local-supabase.sh --trust-clerk-dev-instance: the e2e stack trusts the Clerk development instance its sessions come from", () => {
  it("starts the stack with [auth.third_party.clerk] enabled for the domain the publishable key names, and says which (mutation: leave the copied config.toml unedited → FAILS)", () => {
    const r = run(STACK_SCRIPT, {}, [TRUST_CLERK]);
    expect(r.status, r.output).toBe(0);
    expect(clerkSection(r.startedConfig)).toEqual(["enabled = true", `domain = "${CLERK_DOMAIN}"`]);
    expect(r.output).toContain(CLERK_DOMAIN);
  });

  it("without the flag (verify), the stack is started with the repository's config.toml byte for byte: no third-party issuer, no call to Clerk", () => {
    const r = run(STACK_SCRIPT);
    expect(r.status, r.output).toBe(0);
    expect(r.startedConfig).toBe(fs.readFileSync(path.join(REPO, "packages/db/supabase/config.toml"), "utf8"));
    expect(clerkSection(r.startedConfig)).toEqual(["enabled = false"]);
    expect(indexOf(r.log, /^docker inspect /)).toBe(-1);
  });

  it("reads PostgREST's RUNNING JWKS after the stack starts and before anything is applied, and refuses a stack holding only its own secret (mutation: trust the config edit without reading PostgREST's environment → FAILS)", () => {
    const ok = run(STACK_SCRIPT, {}, [TRUST_CLERK]);
    const start = indexOf(ok.log, /^supabase start /);
    const inspect = indexOf(ok.log, /^docker inspect .*supabase_rest_db/);
    expect(inspect).toBeGreaterThan(start);
    expect(indexOf(ok.log, BOOTSTRAP)).toBeGreaterThan(inspect);

    const r = run(STACK_SCRIPT, { FAKE_REST_ENV: restEnv([OCT_KEY]) }, [TRUST_CLERK]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/::error::.*PostgREST.*Clerk/);
    expect(indexOf(r.log, BOOTSTRAP)).toBe(-1);
    expect(r.githubEnv).toBe("");
  });

  it("refuses a production instance's key (pk_live_) before starting anything", () => {
    const r = run(STACK_SCRIPT, { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkKey("clerk.app.bis-rgv.com$", "pk_live_") }, [TRUST_CLERK]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.*production/);
    expect(indexOf(r.log, /^supabase start /)).toBe(-1);
    expect(r.githubEnv).toBe("");
  });

  it.each([
    ["a custom (production-style) Frontend API domain", "clerk.example.com$"],
    ["a domain with no trailing $", `${CLERK_DOMAIN}`],
    ["a domain that only ends like a development one", `x.clerk.accounts.dev.evil.example$`],
  ])("refuses a key that decodes to %s, before starting anything", (_label, decoded) => {
    const r = run(STACK_SCRIPT, { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkKey(decoded) }, [TRUST_CLERK]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.*development instance/);
    expect(indexOf(r.log, /^supabase start /)).toBe(-1);
  });

  it("refuses a missing key, naming it, before starting anything", () => {
    const r = run(STACK_SCRIPT, { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" }, [TRUST_CLERK]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.*(empty|missing)/);
    expect(indexOf(r.log, /^supabase start /)).toBe(-1);
  });

  it.each([[["--trust-clerk"]], [[TRUST_CLERK, TRUST_CLERK]], [["--local-stack"]]])(
    "refuses any other argument list before starting anything, so a typo never selects verify's stack for e2e: %j",
    (args) => {
      const r = run(STACK_SCRIPT, {}, args);
      expect(r.status).not.toBe(0);
      expect(r.output).toMatch(/::error::.*--trust-clerk-dev-instance/);
      expect(r.log).toEqual([]);
    },
  );
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
