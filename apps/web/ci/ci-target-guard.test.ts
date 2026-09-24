import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const FAKE_CURL = `#!/usr/bin/env bash
# Stand-in for curl: records its argv and stdin, answers with a canned status.
printf '%s\\n' "$@" > "$FAKE_CURL_DIR/argv"
stdin=""
while IFS= read -r line || [ -n "$line" ]; do stdin+="$line"$'\\n'; done
printf '%s' "$stdin" > "$FAKE_CURL_DIR/stdin"
printf '%s' "\${FAKE_CURL_STATUS:-200}"
exit "\${FAKE_CURL_EXIT:-0}"
`;

let fakeDir = "";

beforeAll(() => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-target-guard-"));
  fs.writeFileSync(path.join(fakeDir, "curl"), FAKE_CURL, { mode: 0o755 });
});

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
  const roots: string[] = [];
  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
    if (base) roots.push(path.join(base, "Git"));
  }
  try {
    // .../Git/mingw64/libexec/git-core -> .../Git
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    roots.push(path.resolve(execPath, "..", "..", ".."));
  } catch {
    // no git on PATH; the Program Files candidates above still apply
  }
  for (const root of roots) {
    const candidate = path.join(root, "usr", "bin", "bash.exe");
    if (fs.existsSync(candidate)) return candidate;
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

function runGuard(
  overrides: Partial<Record<GuardVar, string | undefined>> = {},
  curl: { status?: string; exit?: number } = {},
): Run {
  for (const f of ["argv", "stdin"]) fs.rmSync(path.join(fakeDir, f), { force: true });

  // The ambient environment is copied for what bash itself needs, then every
  // variable the guard reads is removed and set only from this case — so a
  // developer's or CI's real secrets can never leak into a case.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of GUARD_VARS) delete env[name];
  const merged = { ...VALID, ...overrides };
  for (const name of GUARD_VARS) {
    const value = merged[name];
    if (value !== undefined) env[name] = value;
  }
  // Windows keeps the variable as "Path"; replace whichever spelling exists.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${fakeDir}${path.delimiter}${env[pathKey] ?? ""}`;
  env.FAKE_CURL_DIR = toBashPath(fakeDir);
  env.FAKE_CURL_STATUS = curl.status ?? "200";
  env.FAKE_CURL_EXIT = String(curl.exit ?? 0);

  const r = spawnSync(bashExecutable(), [SCRIPT], { env, encoding: "utf8" });
  if (r.error) throw r.error;
  const read = (f: string) => {
    const p = path.join(fakeDir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  };
  return {
    status: r.status,
    output: `${r.stdout}${r.stderr}`,
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
    const r = runGuard({
      BIS_CI_SUPABASE_REF: "Not A Ref",
      NEXT_PUBLIC_SUPABASE_URL: "https://Not A Ref.supabase.co",
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*BIS_CI_SUPABASE_REF/);
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
  const secrets = [SECRET_KEY, DB_PASSWORD, CLERK_SECRET, CLERK_PUBLISHABLE, "pk_live_UNIT_TEST_LIVE_PK", "sk_live_UNIT_TEST_LIVE_SK"];

  it.each<[string, Partial<Record<GuardVar, string>>, { status?: string; exit?: number }]>([
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
  ])("%s", (_label, overrides, curl) => {
    const r = runGuard(overrides, curl);
    for (const secret of secrets) expect(r.output).not.toContain(secret);
  });
});
