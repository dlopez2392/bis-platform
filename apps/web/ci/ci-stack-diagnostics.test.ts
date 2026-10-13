import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .github/scripts/ci-stack-diagnostics.sh prints what a red CI job needs to
// tell a Kong/PostgREST fault from a test defect (2026-10-13: bursts of
// "An invalid response was received from the upstream server" with Kong's
// upstream keep-alive already off). ci.yml runs it twice:
//
//   --baseline  in verify, right after `pnpm check`, pass or fail, so green
//               runs record what normal looks like;
//   --failure   last in verify and in e2e, on failure only.
//
// The repository is PUBLIC, so whatever it prints is public: only named
// fields of `docker inspect`, never a container's environment; only the
// error lines of each log, bounded; anything shaped like a key or a DB
// password redacted. And it never fails the job further: every case exits 0.
//
// Run for real, through bash, with fake `docker`, `sudo`, `nsenter`, `ss`,
// `sysctl` and `free` first on PATH, logging how they were called.

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const toBashPath = (p: string) => p.replace(/\\/g, "/");
const SCRIPT = toBashPath(path.join(REPO, ".github/scripts/ci-stack-diagnostics.sh"));

const KONG = "supabase_kong_db";
const REST = "supabase_rest_db";
const DB = "supabase_db_db";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlX2E0MWY";
const SB_SECRET = "sb_secret_UnitTestSecret_9c1e";
const DB_PASSWORD = "UnitTestStackPassword_0d3c";

// `docker inspect -f` answers per container; `docker logs` writes the Kong
// log to STDERR (where nginx's error log goes in Kong's image) and
// PostgREST's to stdout. FAKE_DOCKER_EXIT=1 is a runner with no stack at all.
const FAKE_DOCKER = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$FAKE_DIR/log"
if [ "\${FAKE_DOCKER_EXIT:-0}" != 0 ]; then echo "Error: No such object" >&2; exit "$FAKE_DOCKER_EXIT"; fi
name="\${*: -1}"
case "$1" in
  inspect)
    case "$*" in
      *State.Pid*) case "$name" in supabase_kong_*) echo 4242 ;; supabase_rest_*) echo 5151 ;; *) echo 6161 ;; esac ;;
      *RestartCount*) echo "/$name 0 false 2026-10-13T01:02:03.456Z" ;;
      *) echo "PGRST_JWT_SECRET=${JWT}" ;;
    esac ;;
  logs)
    case "$name" in
      supabase_kong_*) printf '%s' "$FAKE_KONG_LOGS" >&2 ;;
      supabase_rest_*) printf '%s' "$FAKE_REST_LOGS" ;;
    esac ;;
esac
exit 0
`;
const FAKE_SUDO = `#!/usr/bin/env bash
printf 'sudo %s\\n' "$*" >> "$FAKE_DIR/log"
[ "\${FAKE_SUDO_EXIT:-0}" = 0 ] || exit "$FAKE_SUDO_EXIT"
# Without -n, a sudo that wants a password would sit at its prompt.
if [ "$1" != "-n" ]; then echo "fake sudo: a password is required (no -n)" >&2; exit 1; fi
shift
exec "$@"
`;
const FAKE_NSENTER = `#!/usr/bin/env bash
printf 'nsenter %s\\n' "$*" >> "$FAKE_DIR/log"
if [ "$1" != "-t" ] || [ "$3" != "-n" ]; then echo "fake nsenter: want -t PID -n CMD" >&2; exit 97; fi
pid="$2"; shift 3
FAKE_NETNS="$pid" exec "$@"
`;
// TIME_WAIT sockets: FAKE_TW of them to :3000 in Kong's namespace (4242),
// FAKE_TW_REST from :3000 in PostgREST's (5151), none anywhere else. A
// header line unless -H, as the real ss prints one. FAKE_SS_SLEEP makes
// every call hang that long first (`exec`, so a kill reaches the sleeper and
// nothing orphaned holds the pipe), as a walk of tens of thousands of
// sockets under real exhaustion might.
const FAKE_SS = `#!/usr/bin/env bash
ns="\${FAKE_NETNS:-host}"
printf 'ss %s [netns=%s]\\n' "$*" "$ns" >> "$FAKE_DIR/log"
[ -z "\${FAKE_SS_SLEEP:-}" ] || exec sleep "$FAKE_SS_SLEEP"
case "$*" in
  *time-wait*)
    case " $* " in *" -H "*) ;; *) echo "Recv-Q Send-Q Local Address:Port Peer Address:Port Process" ;; esac
    n=0
    case "$ns:$*" in
      4242:*dport*:3000*) n="\${FAKE_TW:-3}" ;;
      5151:*sport*:3000*) n="\${FAKE_TW_REST:-7}" ;;
    esac
    i=0; while [ "$i" -lt "$n" ]; do echo "0 0 172.18.0.5:4$i 172.18.0.4:3000"; i=$((i + 1)); done ;;
  -s*) echo "Total: 321 (netns $ns)"; echo "TCP:   290 (estab 4, closed 280, orphaned 0, timewait 280)" ;;
esac
`;
const FAKE_SYSCTL = `#!/usr/bin/env bash
printf 'sysctl %s [netns=%s]\\n' "$*" "\${FAKE_NETNS:-host}" >> "$FAKE_DIR/log"
case "$*" in
  *tcp_tw_reuse*) echo 1 ;;
  *ip_local_port_range*) printf '1024\\t65000\\n' ;;
esac
`;
const FAKE_FREE = `#!/usr/bin/env bash
printf 'free %s\\n' "$*" >> "$FAKE_DIR/log"
echo "               total        used        free      shared  buff/cache   available"
echo "Mem:           15990        9123        1200          50        5667        6400"
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
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-stack-diagnostics-"));
  fs.mkdirSync(path.join(fakeDir, "bin"));
  for (const [name, body] of [
    ["docker", FAKE_DOCKER], ["sudo", FAKE_SUDO], ["nsenter", FAKE_NSENTER],
    ["ss", FAKE_SS], ["sysctl", FAKE_SYSCTL], ["free", FAKE_FREE],
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

/** Kong's error log: `errors` [error] lines among info lines, a [crit] and a bare connect() line. */
function kongLogs(errors: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= errors; i++) {
    lines.push(`2026/10/13 01:00:${String(i % 60).padStart(2, "0")} [info] 1#0: *${i} client closed keepalive connection`);
    lines.push(`2026/10/13 01:00:${String(i % 60).padStart(2, "0")} [error] 1#0: *${i} upstream prematurely closed connection, number ${i}, upstream: "http://172.18.0.4:3000/plans"`);
  }
  lines.push(`2026/10/13 01:01:00 [crit] 1#0: *999 connect() to 172.18.0.4:3000 failed (99: Cannot assign requested address) apikey=${JWT}`);
  lines.push(`172.18.0.1 - - [13/Oct/2026:01:01:01 +0000] "POST /rest/v1/plans HTTP/1.1" 201 0 "-" "node" apikey=${SB_SECRET}`);
  return lines.join("\n") + "\n";
}
const REST_LOGS = [
  "13/Oct/2026:01:00:00 +0000: Listening on port 3000",
  `13/Oct/2026:01:00:01 +0000: Connection error: postgresql://authenticator:${DB_PASSWORD}@db:5432/postgres refused`,
  "13/Oct/2026:01:00:02 +0000: Schema cache loaded",
  "13/Oct/2026:01:00:03 +0000: FATAL: too many connections for role \"authenticator\"",
  "PGRST_JWT_SECRET=should-never-print",
].join("\n") + "\n";

type Run = { status: number | null; output: string; log: string[]; seconds: number };

function run(args: string[], extraEnv: Record<string, string> = {}): Run {
  fs.rmSync(path.join(fakeDir, "log"), { force: true });
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${path.join(fakeDir, "bin")}${path.delimiter}${env[pathKey] ?? ""}`;
  Object.assign(env, {
    FAKE_DIR: toBashPath(fakeDir),
    FAKE_KONG_LOGS: kongLogs(60),
    FAKE_REST_LOGS: REST_LOGS,
    ...extraEnv,
  });
  const startedAt = Date.now();
  const r = spawnSync(bash, [SCRIPT, ...args], { env, encoding: "utf8", cwd: REPO });
  const seconds = (Date.now() - startedAt) / 1000;
  if (r.error) throw r.error;
  const logFile = path.join(fakeDir, "log");
  const output = `${r.stdout}${r.stderr}`;
  // Whatever it prints is public: no key, no DB password, no environment.
  expect(output.includes(JWT), "printed a JWT").toBe(false);
  expect(output.includes(SB_SECRET), "printed an sb_secret_ key").toBe(false);
  expect(output.includes(DB_PASSWORD), "printed the DB password").toBe(false);
  expect(output.includes("PGRST_JWT_SECRET"), "printed a container's environment").toBe(false);
  return {
    status: r.status,
    seconds,
    output,
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [],
  };
}

describe("ci-stack-diagnostics.sh --failure: what a red job needs to tell a Kong/PostgREST fault from a test defect", () => {
  it("prints, for Kong, PostgREST and the database, only the container's name, restart count, OOM flag and start time (mutation: inspect without -f → the environment, FAILS)", () => {
    const r = run(["--failure"]);
    expect(r.status, r.output).toBe(0);
    for (const c of [KONG, REST, DB]) {
      expect(r.log).toContain(`docker inspect -f {{.Name}} {{.RestartCount}} {{.State.OOMKilled}} {{.State.StartedAt}} ${c}`);
      expect(r.output).toContain(`/${c} 0 false 2026-10-13T01:02:03.456Z`);
    }
    // Every inspect names its fields: none reads .Config (the environment).
    const inspects = r.log.filter((l) => l.startsWith("docker inspect "));
    expect(inspects.length).toBeGreaterThan(0);
    expect(inspects.filter((l) => !/^docker inspect -f \{\{\.(Name|State\.Pid)\}\}/.test(l))).toEqual([]);
  });

  it("counts TIME_WAIT sockets to PostgREST (:3000) inside KONG's network namespace, exactly (no header line), beside the port range and tcp_tw_reuse read there (mutation: count on the runner's own namespace, or drop -H → FAILS)", () => {
    const r = run(["--failure"], { FAKE_TW: "5" });
    expect(r.status, r.output).toBe(0);
    expect(r.log).toContain("sudo -n nsenter -t 4242 -n ss -H -tan state time-wait ( dport = :3000 )");
    expect(r.output).toMatch(/TIME_WAIT to PostgREST \(:3000\) in Kong's network namespace: 5\b/);
    expect(r.output).toMatch(/tcp_tw_reuse=1\b/);
    expect(r.output).toMatch(/ip_local_port_range=1024-65000\b/);
    // On the annotation too, where it can be read off the check run.
    expect(r.output).toMatch(/::notice title=Kong ports \(failure\)::.*TIME_WAIT to :3000: 5\b.*1024-65000/);
  });

  it("also counts TIME_WAIT from :3000 in PostgREST's namespace, so a close on the other side reads as such", () => {
    const r = run(["--failure"], { FAKE_TW_REST: "11" });
    expect(r.log).toContain("sudo -n nsenter -t 5151 -n ss -H -tan state time-wait ( sport = :3000 )");
    expect(r.output).toMatch(/TIME_WAIT from :3000 in PostgREST's network namespace: 11\b/);
  });

  it("prints Kong's error, crit and connect() lines from the last 15 minutes, stderr included, at most 50, and no other line (mutation: drop the filter → access-log lines, FAILS; drop 2>&1 → nothing, FAILS)", () => {
    const r = run(["--failure"]);
    expect(r.log).toContain(`docker logs --since 15m ${KONG}`);
    expect(r.output).toContain("number 60,");
    expect(r.output).toContain("connect() to 172.18.0.4:3000 failed (99: Cannot assign requested address)");
    // 60 [error] + 1 [crit] lines; the last 50 are numbers 12..60 and the crit.
    expect(r.output).toContain("number 12,");
    expect(r.output).not.toContain("number 11,");
    expect(r.output).not.toContain("[info]");
    expect(r.output).not.toContain("POST /rest/v1/plans");
  });

  it("prints PostgREST's error and fatal lines from its last 100, and no other line", () => {
    const r = run(["--failure"]);
    expect(r.log).toContain(`docker logs --tail 100 ${REST}`);
    expect(r.output).toContain("Connection error: postgresql://authenticator:<redacted>@db:5432/postgres refused");
    expect(r.output).toContain('FATAL: too many connections for role "authenticator"');
    expect(r.output).not.toContain("Schema cache loaded");
    expect(r.output).not.toContain("Listening on port 3000");
  });

  it("redacts anything shaped like a JWT, an sb_ key or a DB password inside a printed line (mutation: drop the redaction → the run() guard FAILS)", () => {
    const r = run(["--failure"]);
    expect(r.output).toContain("apikey=<redacted>");
  });

  it("prints the runner's memory (free -m) and socket summary (ss -s), and Kong's", () => {
    const r = run(["--failure"]);
    expect(r.log).toContain("free -m");
    expect(r.log).toContain("ss -s [netns=host]");
    expect(r.log).toContain("ss -s [netns=4242]");
    expect(r.output).toContain("Mem:           15990");
    expect(r.output).toContain("Total: 321 (netns host)");
  });

  it.each([
    ["no stack at all (docker fails)", { FAKE_DOCKER_EXIT: "1" }],
    ["sudo refused", { FAKE_SUDO_EXIT: "1" }],
  ])("never fails the job further: exits 0 with %s, saying what it could not read", (_label, env) => {
    const r = run(["--failure"], env);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/not running|could not|unreadable/i);
  });
});

describe("ci-stack-diagnostics.sh --baseline: the same numbers on a green run, for comparison", () => {
  it("prints the TIME_WAIT count in Kong's namespace and its ss -s, and reads no container log (mutation: print logs on every run → FAILS)", () => {
    const r = run(["--baseline"], { FAKE_TW: "4" });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/TIME_WAIT to PostgREST \(:3000\) in Kong's network namespace: 4\b/);
    expect(r.output).toMatch(/::notice title=Kong ports \(after pnpm check\)::.*TIME_WAIT to :3000: 4\b/);
    expect(r.log).toContain("ss -s [netns=4242]");
    expect(r.log.filter((l) => l.startsWith("docker logs "))).toEqual([]);
  });

  it("exits 0 on a runner with no stack", () => {
    const r = run(["--baseline"], { FAKE_DOCKER_EXIT: "1" });
    expect(r.status, r.output).toBe(0);
  });
});

// Review of 99639481 (2026-10-13): the step's timeout-minutes was the only
// bound, and a step GitHub kills for its timeout fails the JOB whatever the
// script would have exited with: the one way these diagnostics could turn a
// green `pnpm check` red. So every read is bounded inside the script (a
// per-call timeout), and so is the whole script (a budget past which later
// reads are skipped); a read that runs out degrades to "unreadable". Short
// overrides keep these cases fast; the defaults are pinned against ci.yml.
describe("ci-stack-diagnostics.sh: no read can outlive its step", () => {
  it("bounds a read that hangs (here, ss walking a huge socket table): exits 0 well inside the budget, printing the count as unreadable (mutation: drop the per-call timeout → FAILS)", () => {
    const r = run(["--baseline"], { FAKE_SS_SLEEP: "12", CI_DIAG_CALL_TIMEOUT: "1", CI_DIAG_BUDGET: "60" });
    expect(r.status, r.output).toBe(0);
    // Unbounded, two TIME_WAIT reads and an ss -s would take 36s here.
    expect(r.seconds, r.output).toBeLessThan(10);
    expect(r.output).toMatch(/TIME_WAIT to PostgREST \(:3000\) in Kong's network namespace: unreadable/);
    expect(r.output).toMatch(/TIME_WAIT from :3000 in PostgREST's network namespace: unreadable/);
  }, 60_000);

  it("stops reading once the whole script's budget is spent, saying so, and still exits 0 (mutation: drop the budget → four 5s reads, FAILS)", () => {
    const r = run(["--failure"], { FAKE_SS_SLEEP: "12", CI_DIAG_CALL_TIMEOUT: "5", CI_DIAG_BUDGET: "3" });
    expect(r.status, r.output).toBe(0);
    expect(r.seconds, r.output).toBeLessThan(10);
    expect(r.output).toMatch(/::warning::.*budget/);
  }, 60_000);

  it("ci.yml gives every diagnostics step more minutes than the script's default budget plus one last read can take (mutation: lower a step to timeout-minutes: 2 → FAILS)", () => {
    const script = fs.readFileSync(path.join(REPO, ".github/scripts/ci-stack-diagnostics.sh"), "utf8");
    const budget = Number(/CI_DIAG_BUDGET:-(\d+)\}/.exec(script)?.[1]);
    const call = Number(/CI_DIAG_CALL_TIMEOUT:-(\d+)\}/.exec(script)?.[1]);
    const kill = Number(/timeout -k (\d+) /.exec(script)?.[1]);
    expect(budget).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(0);
    expect(kill).toBeGreaterThan(0);
    // The budget is checked before each read, so the last read can start just
    // inside it; then 30s for the script's own process starts, with margin.
    const worstSeconds = budget + call + kill + 30;
    const ci = fs.readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n").split("\n");
    const runs = ci.flatMap((l, i) => (/^\s+run: bash \.github\/scripts\/ci-stack-diagnostics\.sh /.test(l) ? [i] : []));
    expect(runs).toHaveLength(3);
    for (const at of runs) {
      const minutes = ci.slice(at - 3, at).map((l) => /^\s+timeout-minutes: (\d+)\s*$/.exec(l)?.[1]).find(Boolean);
      expect(Number(minutes) * 60, ci[at]).toBeGreaterThan(worstSeconds);
    }
  });
});

describe("ci-stack-diagnostics.sh: any other argument list", () => {
  it.each([[[]], [["--fail"]], [["--failure", "--baseline"]]])("warns, reads nothing and exits 0: %j", (args) => {
    const r = run(args);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/::warning::.*--failure.*--baseline/);
    expect(r.log).toEqual([]);
  });
});
