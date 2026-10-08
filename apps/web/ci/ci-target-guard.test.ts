import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The CI target guard is a shell script, not a module, because both CI jobs
// run it as a preflight step before `pnpm install` has happened. It lives in
// .github/scripts/ and is tested HERE, from the web package's vitest suite,
// because that is what `pnpm check` collects (root `test` = `pnpm -r
// --if-present test`; web's `test` = `vitest run`; vitest.config.ts includes
// `ci/**/*.test.ts`). A test beside the script, outside any workspace
// package, would never run.
//
// The script is run for real, through bash, with nothing but the env each
// case hands it. Its one network call is `curl`, and every case puts a fake
// `curl` first on PATH that records how it was called and answers with a
// canned status: no test here ever reaches Supabase.

const PROD_REF = "tlbkbmlrfafquucsmsmm";
const REF = "cirefcirefcirefciref"; // 20 lowercase characters, like a real ref
const OTHER_REF = "otherotherotherother";

const SCRIPT = toBashPath(
  fileURLToPath(new URL("../../../.github/scripts/ci-target-guard.sh", import.meta.url)),
);

// Every secret a case hands the guard. Distinctive, so an echo of any of them
// is unmistakable in the output.
const SECRET_KEY = "sb_secret_UNIT_TEST_SECRET_KEY_7f3a";
const DB_PASSWORD = "UnitTestDbPassword_9c1e";
const CLERK_SECRET = "sk_test_UNIT_TEST_CLERK_SECRET_4b2d";
const CLERK_PUBLISHABLE = "pk_test_UNIT_TEST_CLERK_PK_81aa";
const STRIPE_TEST = "sk_test_UNIT_TEST_STRIPE_SECRET_5e6f";
const STRIPE_LIVE = "sk_live_UNIT_TEST_STRIPE_LIVE_77c1";

const GUARD_VARS = [
  "BIS_CI_SUPABASE_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
] as const;
type GuardVar = (typeof GUARD_VARS)[number];

/** Read by the guard but optional: absent is fine, present must be valid. */
const OPTIONAL_VARS = ["STRIPE_SECRET_KEY"] as const;
type OptionalVar = (typeof OPTIONAL_VARS)[number];
type AnyVar = GuardVar | OptionalVar;

function dbUrl(user: string, host = "aws-0-us-east-1.pooler.supabase.com:5432") {
  return `postgresql://${user}:${DB_PASSWORD}@${host}/postgres`;
}

const VALID: Record<GuardVar, string> = {
  BIS_CI_SUPABASE_REF: REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_UNIT_TEST_PUBLISHABLE",
  SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY,
  SUPABASE_DB_URL: dbUrl(`postgres.${REF}`),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_PUBLISHABLE,
  CLERK_SECRET_KEY: CLERK_SECRET,
};

const VALID_OPTIONAL: Record<OptionalVar, string> = { STRIPE_SECRET_KEY: STRIPE_TEST };

const FAKE_CURL = `#!/usr/bin/env bash
# Stand-in for curl: records its argv and stdin, answers with a canned status.
printf '%s\\n' "$@" > "$FAKE_CURL_DIR/argv"
stdin=""
while IFS= read -r line || [ -n "$line" ]; do stdin+="$line"$'\\n'; done
printf '%s' "$stdin" > "$FAKE_CURL_DIR/stdin"
printf '%s' "\${FAKE_CURL_STATUS:-200}"
exit "\${FAKE_CURL_EXIT:-0}"
`;

// Every case spawns a real bash, and bash on Windows (MSYS) starts slowly on a
// loaded machine; vitest's 5s default is a flake waiting to happen there.
vi.setConfig({ testTimeout: 20_000 });

let fakeDir = "";
let bash = "";

beforeAll(() => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-target-guard-"));
  fs.writeFileSync(path.join(fakeDir, "curl"), FAKE_CURL, { mode: 0o755 });
  // Resolved once, and started once so the first case does not pay the
  // cold start. A missing bash fails here, and so every case: never a skip.
  bash = bashExecutable();
  const warm = spawnSync(bash, ["-c", ":"], { encoding: "utf8" });
  if (warm.error) throw warm.error;
}, 60_000);

afterAll(() => {
  fs.rmSync(fakeDir, { recursive: true, force: true });
});

/** Forward slashes, which Git Bash and Linux bash both read as a path. */
function toBashPath(p: string) {
  return p.replace(/\\/g, "/");
}

/**
 * The bash that runs the script. On Windows a bare `bash` can resolve to
 * WSL's launcher in System32, or to nothing when the shell that started
 * vitest is PowerShell, so the Git for Windows bash is found explicitly — and
 * its `usr/bin` build, not the `bin` wrapper, so PATH is exactly what this
 * test sets and the fake curl stays first. No bash is a FAILURE, never a skip.
 */
function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  const bashUnder = (root: string) => path.join(root, "usr", "bin", "bash.exe");
  const roots: string[] = [];
  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
    if (base) roots.push(path.join(base, "Git"));
  }
  const found = roots.find((root) => fs.existsSync(bashUnder(root)));
  if (found) return bashUnder(found);
  try {
    // Git installed elsewhere: .../Git/mingw64/libexec/git-core -> .../Git
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const root = path.resolve(execPath, "..", "..", "..");
    roots.push(root);
    if (fs.existsSync(bashUnder(root))) return bashUnder(root);
  } catch {
    // no git on PATH either
  }
  throw new Error(`No Git for Windows bash found (looked under: ${roots.join(", ")})`);
}

type Run = {
  status: number | null;
  output: string;
  curlCalled: boolean;
  curlArgv: string;
  curlStdin: string;
};

/**
 * The secret values a case handed the guard: the secret key, the Clerk
 * secret, the whole DB URL and, separately, the DB URL's password (a derived
 * string like `user:password@host` would not contain the whole URL). Empty
 * values are skipped, since every output "contains" the empty string.
 */
function secretsGiven(merged: Partial<Record<AnyVar, string | undefined>>): string[] {
  const db = merged.SUPABASE_DB_URL ?? "";
  const password = /^[a-z]+:\/\/[^:@/]*:(.+)@[^@]*$/.exec(db)?.[1] ?? "";
  return [merged.SUPABASE_SERVICE_ROLE_KEY, merged.CLERK_SECRET_KEY, merged.STRIPE_SECRET_KEY, db, password].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

/**
 * Runs the guard. EVERY run asserts that its output carries none of the
 * secret values that run was given, so a new message that echoes a value is
 * red in whichever case reaches it, not only in a hand-picked list.
 */
function runGuard(
  overrides: Partial<Record<AnyVar, string | undefined>> = {},
  curl: { status?: string; exit?: number } = {},
  extraEnv: Record<string, string> = {},
  // The mode argument (none = the CI project, as e2e runs it) and the values
  // a case starts from before its overrides (VALID = the CI project's).
  opts: { args?: string[]; base?: Partial<Record<AnyVar, string>> } = {},
): Run {
  for (const f of ["argv", "stdin"]) fs.rmSync(path.join(fakeDir, f), { force: true });

  // The ambient environment is copied for what bash itself needs, then every
  // variable the guard reads is removed and set only from this case — so a
  // developer's or CI's real secrets can never leak into a case.
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Optional variables are stripped too, so an ambient Stripe key (a
  // developer's .env, CI's e2e job) can never leak into a case.
  for (const name of [...GUARD_VARS, ...OPTIONAL_VARS]) delete env[name];
  const merged: Partial<Record<AnyVar, string | undefined>> = {
    ...(opts.base ?? VALID), ...VALID_OPTIONAL, ...overrides,
  };
  for (const name of [...GUARD_VARS, ...OPTIONAL_VARS]) {
    const value = merged[name];
    if (value !== undefined) env[name] = value;
  }
  // Windows keeps the variable as "Path"; replace whichever spelling exists.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${fakeDir}${path.delimiter}${env[pathKey] ?? ""}`;
  env.FAKE_CURL_DIR = toBashPath(fakeDir);
  env.FAKE_CURL_STATUS = curl.status ?? "200";
  env.FAKE_CURL_EXIT = String(curl.exit ?? 0);
  Object.assign(env, extraEnv);

  const r = spawnSync(bash, [SCRIPT, ...(opts.args ?? [])], { env, encoding: "utf8" });
  if (r.error) throw r.error;
  const read = (f: string) => {
    const p = path.join(fakeDir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  };
  const output = `${r.stdout}${r.stderr}`;
  secretsGiven(merged).forEach((secret, i) => {
    expect(output.includes(secret), `the guard printed secret #${i} it was given`).toBe(false);
  });
  return {
    status: r.status,
    output,
    curlCalled: fs.existsSync(path.join(fakeDir, "argv")),
    curlArgv: read("argv"),
    curlStdin: read("stdin"),
  };
}

describe("ci-target-guard.sh: a correctly configured CI project", () => {
  it("passes, and probes that project's REST API once", () => {
    const r = runGuard();
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
    expect(r.curlCalled).toBe(true);
    expect(r.curlArgv).toContain(`https://${REF}.supabase.co/rest/v1/agencies?select=id&limit=1`);
  });

  it("hands the secret key to curl on stdin, never on its command line", () => {
    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.curlStdin).toContain(`apikey: ${SECRET_KEY}`);
    expect(r.curlArgv).not.toContain(SECRET_KEY);
  });

  it("starts curl with -q, so no ~/.curlrc (e.g. one saying `verbose`) can echo the key's header", () => {
    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.curlArgv.split("\n")[0]).toBe("-q");
  });
});

describe("the guard under shell tracing", () => {
  // SHELLOPTS in the environment turns xtrace on before the script's first
  // line, and a trace prints DERIVED strings (`user:password@host`) that
  // GitHub's exact-value log masking would not recognise.
  it("prints no secret when SHELLOPTS=xtrace, on a passing run", () => {
    const r = runGuard({}, {}, { SHELLOPTS: "xtrace" });
    expect(r.status).toBe(0);
  });

  it("prints no secret when SHELLOPTS=xtrace, on a run the DB URL check refuses", () => {
    const r = runGuard({ SUPABASE_DB_URL: dbUrl(`postgres.${OTHER_REF}`) }, {}, { SHELLOPTS: "xtrace" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL/);
  });
});

describe("check 1: every value the gates need is present", () => {
  it.each(GUARD_VARS)("refuses to run when %s is empty, and names it", (name) => {
    const r = runGuard({ [name]: "" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${name}.*(empty|missing)`));
  });

  it.each(GUARD_VARS)("refuses to run when %s is unset", (name) => {
    const r = runGuard({ [name]: undefined });
    expect(r.status).toBe(1);
    expect(r.output).toContain(name);
  });

  it("names the repository secret each CI-project value is read from", () => {
    const r = runGuard({ SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_DB_URL: "" });
    expect(r.status).toBe(1);
    expect(r.output).toContain("CI_SUPABASE_SECRET_KEY");
    expect(r.output).toContain("CI_SUPABASE_DB_URL");
  });
});

describe("check 2: the Supabase URL is exactly the CI project's", () => {
  it("refuses the production project's URL", () => {
    const r = runGuard({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_SUPABASE_URL.*production/);
  });

  it("refuses the production ref even when BIS_CI_SUPABASE_REF itself names it", () => {
    const r = runGuard({
      BIS_CI_SUPABASE_REF: PROD_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      SUPABASE_DB_URL: dbUrl(`postgres.${PROD_REF}`),
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*BIS_CI_SUPABASE_REF.*production/);
  });

  it("refuses the production ref in any letter case", () => {
    const r = runGuard({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF.toUpperCase()}.supabase.co` });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_SUPABASE_URL.*production/);
  });

  it("refuses the production ref inside a secret key or the publishable key", () => {
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
      const r = runGuard({ [name]: `sb_x_${PROD_REF}_x` });
      expect(r.status, name).toBe(1);
      expect(r.output, name).toMatch(new RegExp(`::error::.*${name}.*production`));
    }
  });

  it("refuses another project's URL", () => {
    const r = runGuard({ NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_SUPABASE_URL/);
  });

  it.each([
    `http://${REF}.supabase.co`,
    `https://${REF}.supabase.co/`,
    `https://${REF}.supabase.co.evil.example`,
    `https://x${REF}.supabase.co`,
  ])("refuses a URL that is not exactly https://<ref>.supabase.co: %s", (url) => {
    const r = runGuard({ NEXT_PUBLIC_SUPABASE_URL: url });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("refuses a BIS_CI_SUPABASE_REF that is not shaped like a project ref", () => {
    // URL and DB user both agree with the malformed ref, so the shape check is
    // the ONLY thing that can refuse this run.
    const r = runGuard({
      BIS_CI_SUPABASE_REF: "Not A Ref",
      NEXT_PUBLIC_SUPABASE_URL: "https://Not A Ref.supabase.co",
      SUPABASE_DB_URL: dbUrl("postgres.Not A Ref"),
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::BIS_CI_SUPABASE_REF is not shaped like a Supabase project ref/);
  });
});

describe("check 3: the database URL logs in as the CI project's pooler user", () => {
  it("refuses a DB URL whose user is the production project's", () => {
    const r = runGuard({ SUPABASE_DB_URL: dbUrl(`postgres.${PROD_REF}`) });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL/);
  });

  it("refuses a DB URL whose user is another project's", () => {
    const r = runGuard({ SUPABASE_DB_URL: dbUrl(`postgres.${OTHER_REF}`) });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL.*postgres\.<BIS_CI_SUPABASE_REF>/);
  });

  it("refuses the CI ref appearing anywhere but the user name", () => {
    const r = runGuard({
      SUPABASE_DB_URL: `${dbUrl(`postgres.${OTHER_REF}`)}?application_name=postgres.${REF}`,
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL/);
  });

  it("refuses the direct-connection URI (user `postgres`), which runners cannot reach", () => {
    const r = runGuard({ SUPABASE_DB_URL: dbUrl("postgres", `db.${REF}.supabase.co:5432`) });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL.*Session pooler/);
  });

  it("refuses a value that is not a postgres URI at all (e.g. a key pasted into it)", () => {
    const r = runGuard({ SUPABASE_DB_URL: "sb_secret_pasted_into_the_wrong_box" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL/);
  });
});

describe("check 4: Clerk is the development instance", () => {
  it("refuses a pk_live_ publishable key", () => {
    const r = runGuard({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_UNIT_TEST_LIVE_PK" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.*production/);
  });

  it("refuses an sk_live_ secret key, which is the one that creates and deletes users", () => {
    const r = runGuard({ CLERK_SECRET_KEY: "sk_live_UNIT_TEST_LIVE_SK" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*CLERK_SECRET_KEY.*production/);
  });
});

describe("check 5: the secret key opens the CI project's REST API", () => {
  it("refuses a publishable key in the secret key's place, which the probe alone would pass", () => {
    const r = runGuard({ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_UNIT_TEST_WRONG_BOX" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_SERVICE_ROLE_KEY.*publishable/);
  });

  it("names a 401 as a key that belongs to another project", () => {
    const r = runGuard({}, { status: "401" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*401.*another project/);
    expect(r.output).toContain("CI_SUPABASE_SECRET_KEY");
  });

  it("names a 403 as missing grants, not a wrong key", () => {
    const r = runGuard({}, { status: "403" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*403.*(grant|privilege)/);
    expect(r.output).not.toMatch(/another project/);
  });

  it("names a 404 as a schema that was never pushed", () => {
    const r = runGuard({}, { status: "404" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*404.*migrations/);
  });

  it("names an unreachable project as paused or unreachable, with the dashboard fix", () => {
    const r = runGuard({}, { status: "000", exit: 6 });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*(paused|unreachable)/);
    expect(r.output).toMatch(/Restore/);
    expect(r.output).not.toMatch(/another project/);
  });

  it("names any other status as paused or unhealthy, and says which status", () => {
    const r = runGuard({}, { status: "503" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*503.*(paused|unreachable|unhealthy)/);
  });

  it("never sends the key to a host the static checks refused", () => {
    const r = runGuard({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` });
    expect(r.status).toBe(1);
    expect(r.curlCalled).toBe(false);
  });
});

describe("check 6: a Stripe key, when present, is a TEST-mode key", () => {
  it("passes with no Stripe key at all: only the e2e job carries one (mutation: add STRIPE_SECRET_KEY to check 1's presence loop → FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: undefined });
    expect(r.status).toBe(0);
  });

  it("passes with an empty Stripe key: GitHub sets a missing secret to \"\", not unset (mutation: test that the variable is SET rather than non-empty, e.g. `[ -n \"${STRIPE_SECRET_KEY+x}\" ]` → an empty key is still \"set\", falls into the case statement and hits the catch-all arm → FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: "" });
    expect(r.status).toBe(0);
  });

  it("passes with a restricted test key (rk_test_) (mutation: accept only sk_test_ → FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: "rk_test_UNIT_TEST_RESTRICTED_19ab" });
    expect(r.status).toBe(0);
  });

  it("refuses an sk_live_ key by name, as live, and never probes (mutation: delete check 6 → exit 0, FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: STRIPE_LIVE });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*STRIPE_SECRET_KEY.*live-mode/);
    expect(r.output).toContain("CI_STRIPE_SECRET_KEY");
    expect(r.curlCalled).toBe(false);
  });

  it("refuses an rk_live_ restricted live key (mutation: match only sk_live_ → falls to the generic refusal, loses 'live-mode', FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: "rk_live_UNIT_TEST_RESTRICTED_LIVE_3d" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*STRIPE_SECRET_KEY.*live-mode/);
  });

  it("refuses a value that is not a Stripe secret key (a publishable key in the wrong box) (mutation: drop the catch-all arm → exit 0, FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: "pk_test_UNIT_TEST_WRONG_BOX" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*STRIPE_SECRET_KEY.*not a Stripe test-mode secret key/);
  });
});

describe("the guard reports, it does not stop at the first problem", () => {
  it("names every problem in one run", () => {
    const r = runGuard({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      SUPABASE_DB_URL: dbUrl(`postgres.${OTHER_REF}`),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_UNIT_TEST_LIVE_PK",
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_SUPABASE_URL/);
    expect(r.output).toMatch(/::error::.*SUPABASE_DB_URL/);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  });
});

describe("the guard never prints a secret value", () => {
  const secrets = [SECRET_KEY, DB_PASSWORD, CLERK_SECRET, CLERK_PUBLISHABLE, "pk_live_UNIT_TEST_LIVE_PK", "sk_live_UNIT_TEST_LIVE_SK", STRIPE_TEST, STRIPE_LIVE];

  it.each<[string, Partial<Record<AnyVar, string>>, { status?: string; exit?: number }]>([
    ["passing", {}, {}],
    ["probe 401", {}, { status: "401" }],
    ["probe unreachable", {}, { status: "000", exit: 7 }],
    ["prod URL", { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` }, {}],
    ["prod DB user", { SUPABASE_DB_URL: dbUrl(`postgres.${PROD_REF}`) }, {}],
    ["wrong DB user", { SUPABASE_DB_URL: dbUrl(`postgres.${OTHER_REF}`) }, {}],
    ["direct DB URI", { SUPABASE_DB_URL: dbUrl("postgres", `db.${REF}.supabase.co:5432`) }, {}],
    ["key in DB URL box", { SUPABASE_DB_URL: SECRET_KEY }, {}],
    ["pk_live_", { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_UNIT_TEST_LIVE_PK" }, {}],
    ["sk_live_", { CLERK_SECRET_KEY: "sk_live_UNIT_TEST_LIVE_SK" }, {}],
    ["stripe live key", { STRIPE_SECRET_KEY: STRIPE_LIVE }, {}],
    ["stripe wrong box", { STRIPE_SECRET_KEY: "pk_test_UNIT_TEST_WRONG_BOX" }, {}],
  ])("%s", (_label, overrides, curl) => {
    const r = runGuard(overrides, curl);
    for (const secret of secrets) expect(r.output).not.toContain(secret);
  });
});

// verify and e2e (both since 2026-10-08) each run on a Supabase stack they
// start inside their own runner (.github/scripts/ci-local-supabase.sh), so
// their four Supabase values do not exist when the job starts. Each runs the
// guard twice: once straight after checkout, where it must hold NO cloud
// Supabase value at all (a leaked one would aim the suites or the app at a
// shared project), and once after the stack is up, where every value must
// name that stack on the runner's loopback and nothing else. The one
// CI-project value ci.yml still reads, the migration check's
// BIS_CI_SUPABASE_DB_URL, is scoped to that step alone, so neither guard run
// may ever see it.
const CLERK_ONLY: Partial<Record<AnyVar, string>> = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_PUBLISHABLE,
  CLERK_SECRET_KEY: CLERK_SECRET,
};
const SUPABASE_VARS = [
  "BIS_CI_SUPABASE_REF", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
] as const;
const LOCAL_SECRET_KEY = "eyJUNIT.TEST.LOCAL_SERVICE_ROLE_JWT_2c9d";
const LOCAL_DB_PASSWORD = "UnitTestLocalDbPassword_51fe";
const LOCAL: Partial<Record<AnyVar, string>> = {
  ...CLERK_ONLY,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJUNIT.TEST.LOCAL_ANON_JWT",
  SUPABASE_SERVICE_ROLE_KEY: LOCAL_SECRET_KEY,
  SUPABASE_DB_URL: `postgresql://postgres:${LOCAL_DB_PASSWORD}@127.0.0.1:54322/postgres`,
};
type Curl = { status?: string; exit?: number };
const before = (overrides: Partial<Record<AnyVar, string | undefined>> = {}, curl: Curl = {}) =>
  runGuard(overrides, curl, {}, { args: ["--before-local-stack"], base: CLERK_ONLY });
const local = (overrides: Partial<Record<AnyVar, string | undefined>> = {}, curl: Curl = {}) =>
  runGuard(overrides, curl, {}, { args: ["--local-stack"], base: LOCAL });

const CI_HISTORY_DB_URL = dbUrl(`postgres.${REF}`);

describe("ci-target-guard.sh --before-local-stack: verify's and e2e's preflight, before the job's own stack exists", () => {
  it("passes with the Clerk development keys and no Supabase value at all, and sends nothing anywhere", () => {
    const r = before();
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
    expect(r.curlCalled).toBe(false);
  });

  it.each(SUPABASE_VARS)("refuses %s when it is already set, naming it and where a CI-project value may live instead (mutation: skip this mode's emptiness loop → exit 0, FAILS)", (name) => {
    const r = before({ [name]: VALID[name] });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::${name} is set before this job's local Supabase stack exists.*migration check`));
    expect(r.curlCalled).toBe(false);
  });

  it("refuses the migration check's BIS_CI_SUPABASE_DB_URL in the job's scope: it belongs to that one step (mutation: leave it off this mode's list → FAILS)", () => {
    const r = runGuard({}, {}, { BIS_CI_SUPABASE_DB_URL: CI_HISTORY_DB_URL }, { args: ["--before-local-stack"], base: CLERK_ONLY });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::BIS_CI_SUPABASE_DB_URL is set before this job's local Supabase stack exists/);
    expect(r.output).not.toContain(DB_PASSWORD);
    expect(r.curlCalled).toBe(false);
  });

  it("still names production when the leaked value is production's", () => {
    const r = before({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_SUPABASE_URL.*production/);
  });

  it.each(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"] as const)("refuses to run when %s is missing", (name) => {
    const r = before({ [name]: "" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::.*${name}.*(empty|missing)`));
  });

  it("refuses a production Clerk key", () => {
    const r = before({ CLERK_SECRET_KEY: "sk_live_UNIT_TEST_LIVE_SK" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*CLERK_SECRET_KEY.*production/);
  });

  it("refuses a live Stripe key here too", () => {
    const r = before({ STRIPE_SECRET_KEY: STRIPE_LIVE });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*STRIPE_SECRET_KEY.*live-mode/);
  });
});

describe("ci-target-guard.sh --local-stack: verify and e2e, once the job's stack is up", () => {
  it.each([
    ["BIS_CI_SUPABASE_REF", REF],
    ["BIS_CI_SUPABASE_DB_URL", CI_HISTORY_DB_URL],
  ])("refuses %s beside the stack's values: no CI-project value may be in the scope the app and the suites run in (mutation: no such check in --local-stack → FAILS)", (name, value) => {
    const r = runGuard({}, {}, { [name]: value }, { args: ["--local-stack"], base: LOCAL });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::${name} is set beside the local stack`));
    expect(r.output).not.toContain(DB_PASSWORD);
    expect(r.curlCalled).toBe(false);
  });

  it("passes on the stack's loopback values, and probes that stack's REST API once", () => {
    const r = local();
    expect(r.output).not.toContain("::error::");
    expect(r.status).toBe(0);
    expect(r.curlArgv).toContain("http://127.0.0.1:54321/rest/v1/agencies?select=id&limit=1");
  });

  it("hands the key to curl on stdin only, as both apikey and bearer, with -q first", () => {
    const r = local();
    expect(r.status).toBe(0);
    expect(r.curlStdin).toContain(`apikey: ${LOCAL_SECRET_KEY}`);
    expect(r.curlStdin).toContain(`Authorization: Bearer ${LOCAL_SECRET_KEY}`);
    expect(r.curlArgv).not.toContain(LOCAL_SECRET_KEY);
    expect(r.curlArgv.split("\n")[0]).toBe("-q");
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const)(
    "refuses to run when %s is missing, naming the step that writes it",
    (name) => {
      const r = local({ [name]: "" });
      expect(r.status).toBe(1);
      expect(r.output).toMatch(new RegExp(`::error::${name} is empty or missing.*ci-local-supabase\\.sh`));
      expect(r.curlCalled).toBe(false);
    },
  );

  it("refuses the CI project's cloud URL: neither job runs on a shared project (mutation: accept any https URL → FAILS)", () => {
    const r = local({ NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::NEXT_PUBLIC_SUPABASE_URL is not the local stack's API/);
    expect(r.curlCalled).toBe(false);
  });

  it("refuses production's URL, naming production", () => {
    const r = local({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_SUPABASE_URL.*production/);
    expect(r.curlCalled).toBe(false);
  });

  it.each([
    "http://127.0.0.1.evil.example:54321",
    "http://127.0.0.1:54321/",
    "http://127.0.0.1:54321@evil.example",
    "https://127.0.0.1:54321",
    "http://10.0.0.5:54321",
  ])("refuses an API URL that is not exactly http://<loopback>:<port>: %s", (url) => {
    const r = local({ NEXT_PUBLIC_SUPABASE_URL: url });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::NEXT_PUBLIC_SUPABASE_URL/);
    expect(r.curlCalled).toBe(false);
  });

  it("accepts localhost as the loopback name", () => {
    const r = local({
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      SUPABASE_DB_URL: `postgresql://postgres:${LOCAL_DB_PASSWORD}@localhost:54322/postgres`,
    });
    expect(r.status).toBe(0);
  });

  it.each([
    ["the CI project's pooler", dbUrl(`postgres.${REF}`)],
    ["a host that only starts with the loopback address", `postgresql://postgres:${LOCAL_DB_PASSWORD}@127.0.0.1.evil.example:54322/postgres`],
    ["a query string, where node-pg reads a host= override", `postgresql://postgres:${LOCAL_DB_PASSWORD}@127.0.0.1:54322/postgres?host=evil.example`],
    ["not a postgres URI", "eyJ_pasted_into_the_wrong_box"],
    // PR #200 review: the host was read after the LAST @, so an @ in the PATH
    // or the FRAGMENT put the loopback there while the real host stayed evil.
    ["a loopback host hidden in the path after an @", `postgresql://u@evil.example/x@127.0.0.1:54322/postgres`],
    ["a loopback host hidden in the fragment after #@", `postgresql://u@evil.example#@127.0.0.1:54322/postgres`],
    ["no database name", `postgresql://postgres:${LOCAL_DB_PASSWORD}@127.0.0.1:54322`],
  ])("refuses a DB URL that is not the local stack's: %s (mutation: drop the DB URL check → FAILS)", (_label, value) => {
    const r = local({ SUPABASE_DB_URL: value });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::SUPABASE_DB_URL is not the local stack's database/);
    expect(r.curlCalled).toBe(false);
  });

  it("refuses a publishable key in the secret key's place", () => {
    const r = local({ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_UNIT_TEST_WRONG_BOX" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*SUPABASE_SERVICE_ROLE_KEY.*publishable/);
  });

  it("refuses a production Clerk key", () => {
    const r = local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_UNIT_TEST_LIVE_PK" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.*production/);
  });

  it.each<[string, RegExp]>([
    ["401", /::error::.*401.*local stack/],
    ["403", /::error::.*403.*(grant|privilege)/],
    ["404", /::error::.*404.*migrations/],
    ["000", /::error::.*(reach|start)/],
  ])("names a %s from the local stack in its own terms, never as a paused cloud project", (status, message) => {
    const r = local({}, { status, exit: status === "000" ? 7 : 0 });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(message);
    expect(r.output).not.toMatch(/Restore|dashboard/);
  });

  it.each<[string, Partial<Record<AnyVar, string>>, Curl]>([
    ["passing", {}, {}],
    ["probe 401", {}, { status: "401" }],
    ["DB URL refused", { SUPABASE_DB_URL: `postgresql://postgres:${LOCAL_DB_PASSWORD}@evil.example:5432/postgres` }, {}],
  ])("prints none of the local stack's secrets: %s", (_label, overrides, curl) => {
    const r = local(overrides, curl);
    expect(r.output).not.toContain(LOCAL_SECRET_KEY);
    expect(r.output).not.toContain(LOCAL_DB_PASSWORD);
  });
});

describe("ci-target-guard.sh refuses an argument it does not know", () => {
  it.each([[["--local"]], [["--local-stack", "extra"]], [["local-stack"]]])("refuses %j, so a typo can never pick a mode (mutation: ignore unknown arguments → runs the CI-project checks and exits 0, FAILS)", (args) => {
    const r = runGuard({}, {}, {}, { args });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::ci-target-guard\.sh takes no argument, --before-local-stack or --local-stack/);
    expect(r.curlCalled).toBe(false);
  });
});
