import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// .github/workflows/ci.yml decides which Supabase project the gates write to,
// and nothing else in the repo checks it. The runtime guard
// (.github/scripts/ci-target-guard.sh, tested beside this file) refuses a
// production value once a job is running, but only if the workflow still
// calls it, calls it before anything touches a database, and hands it the
// CI project's names. These cases pin that shape, so a later edit to ci.yml
// that drops the guard, moves it after `pnpm install`, or maps a production
// secret back in is red in `pnpm check` before it ever reaches a runner.
//
// The workflow is read as text, not through a YAML library: web has none as a
// dependency, and the shape pinned here (two-space job keys, `- ` steps,
// one-line `run:` values) is the file's own. Comment lines are dropped first,
// so a step named in a comment can never satisfy an assertion about steps.

const PROD_REF = "tlbkbmlrfafquucsmsmm";
/** Production's publishable key's prefix, the literal ci.yml carried until the switch. */
const PROD_PUBLISHABLE_PREFIX = "sb_publishable_h2Gm";
const GUARD = "bash .github/scripts/ci-target-guard.sh";
/** verify's two guard runs: before its own Supabase stack exists, and once it is up. */
const GUARD_BEFORE_LOCAL = `${GUARD} --before-local-stack`;
const GUARD_LOCAL = `${GUARD} --local-stack`;
/** verify's database: a throwaway stack in its own runner (ci-local-supabase.test.ts). */
const INSTALL_CLI = "bash .github/scripts/ci-supabase-cli.sh";
const START_STACK = "bash .github/scripts/ci-local-supabase.sh";
/** e2e's check that the CI project holds every migration of the branch (ci-migrations-applied.test.ts). */
const MIGRATIONS_APPLIED = "bash .github/scripts/ci-migrations-applied.sh";
/** The credential-free migration plan check (migrations-plan part, 2026-11-13). */
const MIGRATIONS_PLAN = "node .github/scripts/migrations-plan.mjs";
/** e2e seeds the stack in its own runner, never the CI project (packages/db/src/ci-seed/config.ts ciSeedMode). */
const SEED_LOCAL = "pnpm --filter @bis/db ci:seed:local";
/** The names the code reads to find Supabase. verify gets them from its own stack only. */
const SUPABASE_NAMES = [
  "BIS_CI_SUPABASE_REF", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
];
/** The docs-only decision (its behaviour is tested in ci-docs-only.test.ts). */
const SCOPE = "bash .github/scripts/ci-docs-only.sh";
/** The ONE condition a command step in verify or e2e may carry, the diagnostics below aside. */
const DOCS_ONLY_IF = "steps.scope.outputs.docs_only != 'true'";
/**
 * The stack diagnostics (ci-stack-diagnostics.test.ts, 2026-10-13): read-only,
 * never exit non-zero, and the only steps here that run on another condition.
 * verify's baseline runs after `pnpm check` whether it passed or not (a green
 * run's numbers are the comparison); the failure dump is each job's last step.
 */
const DIAGNOSE_BASELINE = "bash .github/scripts/ci-stack-diagnostics.sh --baseline";
const DIAGNOSE_FAILURE = "bash .github/scripts/ci-stack-diagnostics.sh --failure";
const BASELINE_IF = "${{ !cancelled() && steps.scope.outputs.docs_only != 'true' }}";
const FAILURE_IF = "failure()";
const isDiagnostic = (s: { run?: string }) => s.run === DIAGNOSE_BASELINE || s.run === DIAGNOSE_FAILURE;

/**
 * The two REQUIRED checks and their parts (2026-11-12). The ruleset on main
 * requires check runs named exactly `verify` and `e2e`; to cut a push's time
 * to green, each was split into parts that run in parallel, and the required
 * name now belongs to a small gate job that needs every part, runs
 * `if: always()`, and passes only when .github/scripts/ci-gate.sh reads every
 * part's result as `success` (ci-gate.test.ts).
 */
const GATES: Record<"verify" | "e2e", string[]> = {
  verify: ["verify-db", "verify-app"],
  e2e: ["e2e-migrations", "e2e-shard", "migrations-plan"],
};
const PARTS = [...GATES.verify, ...GATES.e2e];
/** The parts that start a Supabase stack in their own runner. */
const STACK_PARTS = ["verify-db", "e2e-shard"];
const GATE_SCRIPT = "bash .github/scripts/ci-gate.sh";
/** verify-db's two suites: the db package's, and the web tests that need a database (vitest project `live`). */
const DB_TESTS = "pnpm --filter @bis/db test";
const WEB_LIVE_TESTS = "pnpm --filter web test --project live";
/**
 * verify-db's drift check on the generated database types: regenerates them
 * from its own stack and fails if packages/db/src/database.types.ts differs
 * (packages/db/src/types-gen). The URL is passed by the variable's NAME.
 */
const TYPES_CHECK = "pnpm --filter @bis/db types:check --db-url-env SUPABASE_DB_URL";
/** verify-app's web suite: everything else (vitest project `unit`). */
const WEB_UNIT_TESTS = "pnpm --filter web test --project unit";
const SHARDS = 4;
const PLAYWRIGHT = `pnpm --filter web test:e2e --shard=\${{ matrix.shard }}/${SHARDS}`;

function read(relative: string): string {
  return fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Every line that is not a comment. Inline comments are not used in these files. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*#/.test(line));
}

/** The lines under a top-level (column-0) key, up to the next top-level key. */
function topLevelBlock(lines: string[], key: string): string[] {
  const start = lines.indexOf(`${key}:`);
  if (start < 0) throw new Error(`no top-level "${key}:" block`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** `NAME: value` pairs at the first indent level of a block. */
function mapping(block: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block) {
    const m = /^ {2}([A-Za-z0-9_-]+): (.+)$/.exec(line);
    const key = m?.[1];
    const value = m?.[2];
    if (key && value) out[key] = value.trim();
  }
  return out;
}

/** Each job's lines, keyed by the job's id. */
function jobs(lines: string[]): Record<string, string[]> {
  const block = topLevelBlock(lines, "jobs");
  const out: Record<string, string[]> = {};
  let current: string[] | null = null;
  for (const line of block) {
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)?.[1];
    if (id) {
      current = [];
      out[id] = current;
    } else if (current) {
      current.push(line);
    }
  }
  return out;
}

/**
 * One step: EVERY key it carries (so `if:` or `continue-on-error:` cannot hide
 * from an assertion that only looked at `run`), and its `uses` and one-line
 * `run` values.
 */
type Step = { keys: string[]; uses?: string; run?: string; if?: string; id?: string };

/** A job's steps in order. */
function steps(job: string[]): Step[] {
  const at = job.findIndex((line) => /^\s+steps:\s*$/.test(line));
  if (at < 0) throw new Error("job has no steps");
  const out: Step[] = [];
  let dashIndent = -1;
  for (const line of job.slice(at + 1)) {
    const dash = /^(\s*)- ([A-Za-z0-9_-]+):(?: (.*))?$/.exec(line);
    const indent = dash?.[1]?.length;
    let key: string | undefined;
    let value: string | undefined;
    if (dash && indent !== undefined && (dashIndent < 0 || indent === dashIndent)) {
      dashIndent = indent;
      out.push({ keys: [] });
      key = dash[2];
      value = dash[3];
    } else if (dashIndent >= 0) {
      // A sibling key of the step: exactly two columns right of its dash.
      const sibling = new RegExp(`^ {${dashIndent + 2}}([A-Za-z0-9_-]+):(?: (.*))?$`).exec(line);
      key = sibling?.[1];
      value = sibling?.[2];
    }
    const step = out[out.length - 1];
    if (!step || !key) continue;
    step.keys.push(key);
    if ((key === "uses" || key === "run" || key === "if" || key === "id") && value) step[key] = value.trim();
  }
  return out;
}

/** The keys set directly on a job (four columns in): `name`, `if`, `needs`… */
function jobKeys(job: string[]): string[] {
  return job.flatMap((line) => {
    const key = /^ {4}([A-Za-z0-9_-]+):/.exec(line)?.[1];
    return key ? [key] : [];
  });
}

/** A one-line value set directly on a job (`if: always()`, `needs: [a, b]`), or undefined. */
function jobValue(job: string[], key: string): string | undefined {
  for (const line of job) {
    const m = new RegExp(`^ {4}${key}: (.+)$`).exec(line);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

/** A job's `needs`, written one-line as `[a, b]` or as a bare id. */
function jobNeeds(job: string[]): string[] {
  const v = jobValue(job, "needs");
  if (!v) return [];
  return v.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** `NAME: value` pairs in a job's OWN `env:` block (six columns in). */
function jobEnv(jobLines: string[]): Record<string, string> {
  const at = jobLines.findIndex((line) => /^ {4}env:\s*$/.test(line));
  if (at < 0) return {};
  const out: Record<string, string> = {};
  for (const line of jobLines.slice(at + 1)) {
    if (line.trim() !== "" && !/^ {6}/.test(line)) break;
    const m = /^ {6}([A-Za-z0-9_-]+): (.+)$/.exec(line);
    if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * `NAME: value` pairs in the `env:` of the ONE step of a job whose `run:` is
 * exactly `run`. A step's env is scoped to that step: GitHub hands it to no
 * other step, which is why the CI project's DB URL may live there and nowhere
 * else in ci.yml.
 */
function stepEnv(jobLines: string[], run: string): Record<string, string> {
  const runAt = jobLines.findIndex((l) => l.trim() === `run: ${run}`);
  if (runAt < 0) throw new Error(`no step runs "${run}"`);
  let dash = runAt;
  while (dash >= 0 && !/^\s*- /.test(jobLines[dash]!)) dash--;
  const dashIndent = jobLines[dash]!.search(/\S/);
  const rest = jobLines.slice(dash + 1);
  const end = rest.findIndex((l) => l.trim() !== "" && l.search(/\S/) <= dashIndent);
  const block = end < 0 ? rest : rest.slice(0, end);
  const envAt = block.findIndex((l) => /^\s+env:\s*$/.test(l));
  if (envAt < 0) return {};
  const envIndent = block[envAt]!.search(/\S/);
  const out: Record<string, string> = {};
  for (const line of block.slice(envAt + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= envIndent) break;
    const m = /^\s+([A-Za-z0-9_]+): (.+)$/.exec(line);
    if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

const ciLines = codeLines(read("../../../.github/workflows/ci.yml"));
const ciEnv = mapping(topLevelBlock(ciLines, "env"));
const ciJobs = jobs(ciLines);
/** A job's lines, or a failure naming the job it could not find. */
function job(id: string): string[] {
  const lines = ciJobs[id];
  if (!lines) throw new Error(`ci.yml has no job "${id}"`);
  return lines;
}
const setupEnv = mapping(topLevelBlock(codeLines(read("../../../.github/workflows/ci-project-setup.yml")), "env"));

describe("ci.yml points the gates at the CI Supabase project, never production's", () => {
  it("references none of the production Supabase secrets", () => {
    // Those three names still mean production for seed-demo.yml (the demo
    // tenant production keeps for live demos). The CI project's credentials
    // are the CI_* secrets.
    // Case-insensitive: GitHub resolves context properties regardless of case,
    // so `secrets.supabase_db_url` reads the same secret.
    const found = ciLines.filter((line) =>
      /secrets\.(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL)\b/i.test(line));
    expect(found).toEqual([]);
  });

  it("reads secrets only by name, and only the five it needs (mutation: re-add `SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.CI_SUPABASE_SECRET_KEY }}` to e2e → FAILS)", () => {
    // `secrets['X']` and `toJSON(secrets)` reach a production secret without
    // ever writing `secrets.X`. So every mention of the secrets context must
    // be exactly `secrets.<one of these>`; anything else is listed.
    // CI_SUPABASE_SECRET_KEY left this list on 2026-10-08: neither job writes
    // to the CI project any more, so nothing here may hold its secret key.
    const allowed = new Set([
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY",
      "CI_SUPABASE_DB_URL", "OPENAI_API_KEY",
      "CI_STRIPE_SECRET_KEY",
    ]);
    const offending = ciLines.flatMap((line) =>
      [...line.matchAll(/\bsecrets\b(\.[A-Za-z0-9_]+)?/gi)]
        .filter((m) => m[0].slice(0, 8) !== "secrets." || !allowed.has(m[0].slice(8)))
        .map(() => line.trim()));
    expect(offending).toEqual([]);
  });

  it("carries neither production's project ref nor its publishable key", () => {
    const found = ciLines.filter((line) => line.includes(PROD_REF) || line.includes(PROD_PUBLISHABLE_PREFIX));
    expect(found).toEqual([]);
  });

  // verify and e2e each run on a stack they start in their own runner (both
  // since 2026-10-08). A cloud value in the workflow-level env or a job's env
  // would reach the suites or the app: depending on how GitHub orders `env:`
  // against GITHUB_ENV it could aim them back at the shared project, and it
  // would hand a job a credential it has no use for. The guard's two local
  // modes refuse that at run time; this refuses it in review.
  // Every job since 2026-11-12, gates and scanner included: the split added
  // four job envs a cloud value could be pasted into.
  it.each(Object.keys(ciJobs))("gives %s no cloud Supabase value: none in the workflow-level env, none in its job env (mutation: put NEXT_PUBLIC_SUPABASE_URL back in e2e-shard's env → FAILS)", (id) => {
    expect(SUPABASE_NAMES.filter((n) => n in ciEnv)).toEqual([]);
    expect([...SUPABASE_NAMES, "BIS_CI_SUPABASE_DB_URL"].filter((n) => n in jobEnv(job(id)))).toEqual([]);
  });

  it("never names the CI project's secret key at all: neither job writes to that project (mutation: map CI_SUPABASE_SECRET_KEY into e2e again → FAILS)", () => {
    expect(ciLines.filter((l) => l.includes("CI_SUPABASE_SECRET_KEY"))).toEqual([]);
  });

  // The ONE place ci.yml still reads the CI project (2026-10-08): e2e's check
  // that bis-ci holds every migration of the branch ("CI project FIRST"). It
  // needs bis-ci's DB URL, read-only, and nothing else does, so the secret is
  // scoped to that step under a name no app code reads; the guard refuses it
  // in the job's scope (ci-target-guard.test.ts).
  // e2e-migrations since 2026-11-12: the check left the e2e job when e2e was
  // split into shards, so it reads bis-ci once per push, not once per shard.
  it("reads secrets.CI_SUPABASE_DB_URL on exactly one line, inside e2e-migrations' migration check step's own env, as BIS_CI_SUPABASE_DB_URL (mutation: map it in a job env, or as SUPABASE_DB_URL → FAILS)", () => {
    const matches = ciLines.filter((l) => l.includes("secrets.CI_SUPABASE_DB_URL"));
    expect(matches.map((l) => l.trim())).toEqual(["BIS_CI_SUPABASE_DB_URL: ${{ secrets.CI_SUPABASE_DB_URL }}"]);
    expect(stepEnv(job("e2e-migrations"), MIGRATIONS_APPLIED).BIS_CI_SUPABASE_DB_URL).toBe("${{ secrets.CI_SUPABASE_DB_URL }}");
    for (const id of Object.keys(ciJobs).filter((j) => j !== "e2e-migrations")) {
      expect(job(id).filter((l) => /secrets\.CI_SUPABASE_/.test(l)), id).toEqual([]);
    }
  });

  /** Every job but the Playwright shards: none may carry what only the shards' app and specs read. */
  const notShards = () => Object.keys(ciJobs).filter((j) => j !== "e2e-shard");

  it("hands the Stripe TEST key to the e2e shards only, as STRIPE_SECRET_KEY (mutation: move it to the top-level env, or drop it → FAILS)", () => {
    expect(jobEnv(job("e2e-shard")).STRIPE_SECRET_KEY).toBe("${{ secrets.CI_STRIPE_SECRET_KEY }}");
    for (const id of notShards()) expect(jobEnv(job(id)).STRIPE_SECRET_KEY, id).toBeUndefined();
    expect(ciEnv.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("gives the e2e shards — and only them — the AI gateway's fake provider as a literal (item 8a-1, spec 6; mutation: drop it, or move it to the top-level env -> FAILS)", () => {
    expect(jobEnv(job("e2e-shard")).AI_PROVIDER).toBe("fake");
    for (const id of notShards()) expect(jobEnv(job(id)).AI_PROVIDER, id).toBeUndefined();
    expect(ciEnv.AI_PROVIDER).toBeUndefined();
  });

  it("references secrets.CI_STRIPE_SECRET_KEY on exactly one non-comment line: e2e-shard's own job-level env (mutation: also give a STEP inside verify-db its own `env: STRIPE_SECRET_KEY: ${{ secrets.CI_STRIPE_SECRET_KEY }}` — jobEnv only reads a job's 4-space env: block, so the two checks above stay green and this is the only one that FAILS)", () => {
    const matches = ciLines.filter((line) => line.includes("secrets.CI_STRIPE_SECRET_KEY"));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.trim()).toBe("STRIPE_SECRET_KEY: ${{ secrets.CI_STRIPE_SECRET_KEY }}");
    // The one occurrence is the same line jobEnv already found inside the
    // shards' own job-level env: block, not a second copy living on some step.
    expect(jobEnv(job("e2e-shard")).STRIPE_SECRET_KEY).toBe("${{ secrets.CI_STRIPE_SECRET_KEY }}");
  });

  it("gives the e2e shards — and only them — the fixture webhook signing secret as a LITERAL, never a secrets reference: the e2e signs its own fixture events with it, and it signs nothing anywhere else (mutation: move it to the top-level env, or read it from secrets → FAILS)", () => {
    expect(jobEnv(job("e2e-shard")).STRIPE_WEBHOOK_SECRET).toBe("whsec_bis_ci_e2e_fixture_only");
    for (const id of notShards()) expect(jobEnv(job(id)).STRIPE_WEBHOOK_SECRET, id).toBeUndefined();
    expect(ciEnv.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(ciLines.filter((l) => l.includes("STRIPE_WEBHOOK_SECRET") && !l.trim().startsWith("#"))).toHaveLength(1);
  });

  it("the e2e shards turn BILLING_ENFORCE on and no other job does (mutation: remove it, or add it to verify-db → FAILS)", () => {
    // jobEnv returns the line's raw text after the colon, quotes included
    // (as written in ci.yml, matching BIS_I18N_QA's own quoted "1" below).
    expect(jobEnv(job("e2e-shard")).BILLING_ENFORCE).toBe("\"1\"");
    for (const id of notShards()) expect(jobEnv(job(id)).BILLING_ENFORCE, id).toBeUndefined();
    expect(ciEnv.BILLING_ENFORCE).toBeUndefined();
  });

  it("gives the e2e shards — and only them — a fixed OWNER_LINE_PIN_PEPPER literal of at least 32 characters, never a secrets reference, so the owner-line setup spec can save a PIN (F-032 Task 15; mutation: drop it, shorten it, read it from secrets, or add it to verify-db or the top-level env → FAILS)", () => {
    const value = jobEnv(job("e2e-shard")).OWNER_LINE_PIN_PEPPER;
    expect(value).toBe("bis_ci_e2e_owner_line_pin_pepper_fixture_only");
    // pinPepperConfigured's own floor (lib/owner-line/secrets.ts PEPPER_MIN): a shorter value reads as unset.
    expect(value!.length).toBeGreaterThanOrEqual(32);
    for (const id of notShards()) expect(jobEnv(job(id)).OWNER_LINE_PIN_PEPPER, id).toBeUndefined();
    expect(ciEnv.OWNER_LINE_PIN_PEPPER).toBeUndefined();
    expect(ciLines.filter((l) => l.includes("OWNER_LINE_PIN_PEPPER") && !l.trim().startsWith("#"))).toHaveLength(1);
  });

  it("the migration check names the same CI project as the setup workflow that builds it, as a literal ref", () => {
    // The project ci-project-setup.yml bootstraps and pushes is the one whose
    // history the branch is checked against. A rebuilt project changes both
    // files together.
    expect(setupEnv.BIS_CI_SUPABASE_REF).toMatch(/^[a-z0-9]{20}$/);
    expect(stepEnv(job("e2e-migrations"), MIGRATIONS_APPLIED).BIS_CI_SUPABASE_REF).toBe(setupEnv.BIS_CI_SUPABASE_REF);
  });
});

// The demo screenshot capture runs on the CI project (2026-10-08). Production
// no longer accepts the development Clerk instance's tokens, and must not:
// since #189 every CI run mints a development agency_admin user, so trusting
// that instance would hand those users production's data. The 5 AM capture
// that day photographed four error screens for exactly that reason.
describe("screenshots.yml captures on the CI project, never production's", () => {
  const shotLines = codeLines(read("../../../.github/workflows/screenshots.yml"));
  const shotJobs = jobs(shotLines);
  const capture = shotJobs.capture;
  if (!capture) throw new Error('screenshots.yml has no job "capture"');
  const env = jobEnv(capture);

  it("references none of the production Supabase secrets (mutation: map SUPABASE_SERVICE_ROLE_KEY back to secrets.SUPABASE_SERVICE_ROLE_KEY → FAILS)", () => {
    const found = shotLines.filter((line) =>
      /secrets\.(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL)\b/i.test(line));
    expect(found).toEqual([]);
    expect(shotLines.filter((line) => line.includes(PROD_REF) || line.includes(PROD_PUBLISHABLE_PREFIX))).toEqual([]);
  });

  it("names the same CI project as the setup workflow that builds it, with the CI_* secrets mapped onto the names the code reads", () => {
    // Pinned against ci-project-setup.yml since 2026-10-08: ci.yml's jobs both
    // run on stacks of their own and hold none of the CI project's literals
    // (e2e's migration check holds only its ref). Compared to a defined
    // value, so the two can never "agree" by both being absent.
    expect(setupEnv.BIS_CI_SUPABASE_REF).toMatch(/^[a-z0-9]{20}$/);
    expect(env.BIS_CI_SUPABASE_REF).toBe(setupEnv.BIS_CI_SUPABASE_REF);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(setupEnv.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(`https://${setupEnv.BIS_CI_SUPABASE_REF}.supabase.co`);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toMatch(/^sb_publishable_/);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("${{ secrets.CI_SUPABASE_SECRET_KEY }}");
    expect(env.SUPABASE_DB_URL).toBe("${{ secrets.CI_SUPABASE_DB_URL }}");
  });

  it("runs ci.yml's target guard before it seeds or captures anything (mutation: drop the guard step → FAILS)", () => {
    const runs = steps(capture).map((step) => step.run ?? step.uses ?? "");
    const guard = runs.indexOf(GUARD);
    expect(guard).toBeGreaterThanOrEqual(0);
    const seed = runs.findIndex((r) => r.includes("db:seed-demo"));
    const shoot = runs.findIndex((r) => r.includes("screenshots"));
    expect(seed).toBeGreaterThan(guard);
    expect(shoot).toBeGreaterThan(guard);
  });

  it("declares no environment, like the CI gates: it reads nothing the production environment holds (mutation: re-add `environment: production` → FAILS)", () => {
    expect(jobKeys(capture)).not.toContain("environment");
  });

  // The capture rewrites a whole account in the CI project when it re-seeds,
  // so two captures must not overlap: it keeps its queue, under the name it
  // has always taken. ci.yml's e2e took the same lock until 2026-10-08,
  // because both drove a browser through the CI project; e2e now runs on a
  // stack in its own runner and takes no lock at all (asserted below).
  it("queues on its own lock for the CI project, never cancelling (mutation: back to e2e-shared-supabase → FAILS)", () => {
    const lock = mapping(topLevelBlock(shotLines, "concurrency"));
    expect(lock.group).toBe("e2e-ci-supabase");
    expect(lock["cancel-in-progress"]).toBe("false");
    expect(lock.queue).toBe("max");
  });
});

describe("ci.yml's jobs", () => {
  // 2026-11-12: the ruleset on main requires check runs named exactly
  // `verify` and `e2e`. Each is now a GATE job whose parts run in parallel on
  // their own runners: verify = verify-db (the suites that need a database) +
  // verify-app (typecheck, lint, the web unit suite, the build); e2e =
  // e2e-migrations (bis-ci holds every migration) + e2e-shard (Playwright in
  // four shards, each on its own stack). No PART needs another: e2e starts
  // beside verify as it has since 2026-10-08 (the b9f31dc timeouts that once
  // made e2e wait for verify were two jobs racing for ONE database; every
  // part now has its own or none), and the shards do not wait for the
  // migration check (a red one is its own check run within a minute, and
  // "Re-run failed jobs" after pushing the migration re-runs only it and the
  // gate). A red part still blocks the merge: its gate is red.
  it("keeps the job ids the main ruleset requires as gates, and each gate needs exactly its parts (mutation: drop e2e-migrations from e2e's needs → FAILS)", () => {
    expect(Object.keys(ciJobs)).toEqual(expect.arrayContaining(["verify", "e2e", ...PARTS]));
    for (const [gate, parts] of Object.entries(GATES)) expect(jobNeeds(job(gate)), gate).toEqual(parts);
  });

  it.each(PARTS)("%s needs nothing, so it starts the moment a runner is free (mutation: re-add `needs: verify-db` to e2e-shard, or `needs: e2e-migrations` → FAILS)", (id) => {
    expect(jobKeys(job(id))).not.toContain("needs");
  });

  it.each(PARTS)("%s has no job-level name, if or continue-on-error", (id) => {
    // A part skipped by a job-level `if:` reports `skipped`, which the gate
    // refuses but which tells nobody why; `continue-on-error` turns a red part
    // green; a `name:` would make its check run harder to find from the gate.
    const keys = jobKeys(job(id));
    expect(keys).toContain("steps"); // the parser found the job's own keys
    expect(keys.filter((k) => ["name", "if", "continue-on-error"].includes(k))).toEqual([]);
  });

  // The gate is the required check. A `name:` renames the check run, so the
  // ruleset's `verify` / `e2e` would never report. `if: always()` and nothing
  // weaker: a gate that `needs` a failed part is SKIPPED unless it says
  // always(), and GitHub reports a skipped required check as passing;
  // `!cancelled()` would skip it on a cancelled run the same way.
  it.each(Object.keys(GATES))("the %s gate has no name or continue-on-error, runs if: always(), and passes only through ci-gate.sh reading every part's result (mutation: `if: success()`, or drop one part's line from the gate's env → FAILS)", (gate) => {
    const lines = job(gate);
    const keys = jobKeys(lines);
    expect(keys.filter((k) => ["name", "continue-on-error", "strategy"].includes(k))).toEqual([]);
    expect(jobValue(lines, "if")).toBe("always()");
    const all = steps(lines);
    expect(all).toHaveLength(2);
    expect(all[0]?.uses ?? "").toMatch(/^actions\/checkout@/);
    const check = all[1]!;
    expect([...check.keys].sort()).toEqual(["env", "name", "run"]);
    const env = stepEnv(lines, check.run!);
    // One variable per part, holding that part's result, and the script
    // handed exactly those variables.
    const parts = GATES[gate as keyof typeof GATES];
    expect(Object.values(env)).toEqual(parts.map((p) => `\${{ needs.${p}.result }}`));
    expect(check.run).toBe(`${GATE_SCRIPT} ${Object.keys(env).join(" ")}`);
  });

  it.each(PARTS)("%s runs the target guard straight after checkout, before anything else", (id) => {
    const [first, second] = steps(job(id));
    expect(first?.uses ?? "").toMatch(/^actions\/checkout@/);
    expect(second?.run).toBe(GUARD_BEFORE_LOCAL);
    // Nothing else on the step: an `if:` could skip it and a
    // `continue-on-error:` could let a refusal pass.
    expect([...(second?.keys ?? [])].sort()).toEqual(["name", "run"]);
  });

  it.each(PARTS)("%s lets no step fail quietly, and skips a command on no condition but the docs-only one (mutation: `if: always()` on the db tests → FAILS)", (id) => {
    const all = steps(job(id));
    expect(all.length).toBeGreaterThan(3);
    expect(all.filter((s) => s.keys.includes("continue-on-error"))).toEqual([]);
    // The diagnostics' own conditions are pinned exactly, below.
    expect(all.filter((s) => s.run && s.keys.includes("if") && s.if !== DOCS_ONLY_IF && !isDiagnostic(s))).toEqual([]);
  });

  // 2026-10-13: Kong 502s in bursts with keep-alive already off. The dump
  // that tells port exhaustion from a test defect runs only when the job has
  // already failed, as its LAST step, so it reads the stack as the failure
  // left it and can change no gate's outcome. verify-db also prints the same
  // port numbers right after its suites, pass or fail, so a green run is the
  // baseline. Neither carries continue-on-error (the script exits 0 by
  // itself, which ci-stack-diagnostics.test.ts pins), and each is bounded.
  // Only the parts that start a stack have one: verify-app and e2e-migrations
  // have no stack to read.
  it.each([
    ["verify-db", [DIAGNOSE_BASELINE, DIAGNOSE_FAILURE]],
    ["e2e-shard", [DIAGNOSE_FAILURE]],
    ["verify-app", []],
    ["e2e-migrations", []],
    ["migrations-plan", []],
  ] as const)("%s's stack diagnostics: the failure dump last, on failure() only; verify-db's baseline straight after its last suite, unless cancelled or docs-only; each bounded, nothing else on the step (mutation: drop the failure step, or give it `if: always()` → FAILS)", (id, expected) => {
    const all = steps(job(id));
    expect(all.filter(isDiagnostic).map((s) => s.run)).toEqual(expected);
    if (expected.length === 0) return;
    const last = all[all.length - 1];
    expect(last?.run).toBe(DIAGNOSE_FAILURE);
    expect(last?.if).toBe(FAILURE_IF);
    for (const s of all.filter(isDiagnostic)) {
      expect([...s.keys].sort(), s.run).toEqual(["if", "name", "run", "timeout-minutes"]);
    }
    if (id === "verify-db") {
      const runs = all.map((s) => s.run);
      const baseline = all[runs.indexOf(DIAGNOSE_BASELINE)];
      expect(runs.indexOf(DIAGNOSE_BASELINE)).toBe(runs.indexOf(WEB_LIVE_TESTS) + 1);
      expect(baseline?.if).toBe(BASELINE_IF);
    }
  });

  it("verify-db runs exactly the guard, the docs-only decision, the install, its own Supabase stack, the guard again on that stack, the generated-types drift check, the db suite, the web tests that need a database, the stack baseline and the failure dump, in that order (mutation: drop the --local-stack guard step, or the types check → FAILS)", () => {
    const runs = steps(job("verify-db")).flatMap((s) => (s.run ? [s.run] : []));
    expect(runs).toEqual([
      GUARD_BEFORE_LOCAL, SCOPE, "pnpm install --frozen-lockfile",
      INSTALL_CLI, START_STACK, GUARD_LOCAL, TYPES_CHECK,
      DB_TESTS, WEB_LIVE_TESTS, DIAGNOSE_BASELINE, DIAGNOSE_FAILURE,
    ]);
  });

  // verify-app starts no stack and holds no Supabase value at all: its guard
  // run is the before-local-stack one, and no step after it may start a
  // stack. The build reads no database (only /_not-found prerenders; every
  // other route is dynamic), so it needs none.
  it("verify-app runs exactly the guard, the docs-only decision, the install, typecheck, lint, the web unit suite and the production build, in that order (mutation: move the build to verify-db → FAILS)", () => {
    const runs = steps(job("verify-app")).flatMap((s) => (s.run ? [s.run] : []));
    expect(runs).toEqual([
      GUARD_BEFORE_LOCAL, SCOPE, "pnpm install --frozen-lockfile",
      "pnpm typecheck", "pnpm lint", WEB_UNIT_TESTS, "pnpm --filter web build",
    ]);
  });

  // 2026-11-12: the ONE read of bis-ci, in a job of its own so it happens once
  // per push rather than once per shard. It needs only bash and psql: no
  // install, no stack.
  it("e2e-migrations runs exactly the guard, the docs-only decision and the migration check, with the check's two values scoped to its step (mutation: drop the step, or move the check into e2e-shard → FAILS)", () => {
    const all = steps(job("e2e-migrations"));
    expect(all.flatMap((s) => (s.run ? [s.run] : []))).toEqual([GUARD_BEFORE_LOCAL, SCOPE, MIGRATIONS_APPLIED]);
    expect(all.filter((s) => s.uses).map((s) => s.uses)).toEqual([expect.stringMatching(/^actions\/checkout@/)]);
    const check = all.find((s) => s.run === MIGRATIONS_APPLIED);
    expect(check?.if).toBe(DOCS_ONLY_IF);
    expect(Object.keys(stepEnv(job("e2e-migrations"), MIGRATIONS_APPLIED)).sort()).toEqual(["BIS_CI_SUPABASE_DB_URL", "BIS_CI_SUPABASE_REF"]);
    // No other job runs it: verify's parts hold no CI-project value, and the
    // shards would read bis-ci four times.
    for (const id of Object.keys(ciJobs).filter((j) => j !== "e2e-migrations")) {
      expect(steps(job(id)).map((s) => s.run), id).not.toContain(MIGRATIONS_APPLIED);
    }
  });

  // The migration plan check (2026-11-13) refuses what the pipeline cannot
  // apply safely, from git alone. It must hold NOTHING: no secret, no env, no
  // install, so no branch's code reaches a credential through it, and it can
  // never be what makes a push without migrations slower.
  it("migrations-plan runs exactly the guard, the docs-only decision, node 24 without pnpm and the plan check, and holds no secret, no env and no install (mutation: map CI_SUPABASE_DB_URL onto its step, or add `pnpm install` → FAILS)", () => {
    const lines = job("migrations-plan");
    const all = steps(lines);
    expect(all.flatMap((s) => (s.run ? [s.run] : []))).toEqual([GUARD_BEFORE_LOCAL, SCOPE, MIGRATIONS_PLAN]);
    expect(all.filter((s) => s.uses).map((s) => s.uses)).toEqual([
      expect.stringMatching(/^actions\/checkout@/),
      expect.stringMatching(/^actions\/setup-node@/),
    ]);
    expect(lines.filter((l) => /package-manager-cache:\s*false\s*$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /secrets\./.test(l))).toEqual([]);
    expect(lines.filter((l) => /^\s+env:\s*$/.test(l))).toEqual([]);
    expect(jobKeys(lines)).not.toContain("environment");
    // No other job runs it, and it runs nothing that could install code.
    for (const id of Object.keys(ciJobs).filter((j) => j !== "migrations-plan")) {
      expect(steps(job(id)).map((s) => s.run), id).not.toContain(MIGRATIONS_PLAN);
    }
  });

  // Each shard is a whole e2e run on its own stack: setup and teardown are
  // Playwright DEPENDENCY projects, which it runs in every shard (checked
  // against Playwright 1.62's loader and `--list`, 2026-11-12), and each shard
  // builds the app with its own stack's URL baked in. ORDER IS LOAD-BEARING:
  // Playwright builds the app inside its own step, and NEXT_PUBLIC_SUPABASE_URL
  // is baked in at build time, so the stack must be up, and its values in
  // GITHUB_ENV, before that step. "|" is the Chromium install, a multi-line
  // `run:`.
  it("e2e-shard runs exactly the guard, the docs-only decision, the install, its own Clerk-trusting stack, the guard again on that stack, the seed of THAT stack, Chromium, its shard of Playwright and the failure dump, in that order (mutation: start the stack after Playwright, or without --trust-clerk-dev-instance → FAILS)", () => {
    const runs = steps(job("e2e-shard")).flatMap((s) => (s.run ? [s.run] : []));
    expect(runs).toEqual([
      GUARD_BEFORE_LOCAL, SCOPE, "pnpm install --frozen-lockfile",
      INSTALL_CLI, `${START_STACK} --trust-clerk-dev-instance`, GUARD_LOCAL,
      SEED_LOCAL, "|", PLAYWRIGHT, DIAGNOSE_FAILURE,
    ]);
  });

  // fail-fast OFF: one red shard must not cancel the others, or a run would
  // name one failing spec and hide the rest. The shard total in the command
  // is the matrix's length, so a shard cannot be added to one and not the
  // other (a 4 in a 5-leg matrix is a Playwright error on leg 5; a 5 in a
  // 4-leg matrix silently never runs the fifth shard's specs).
  it("e2e-shard is a matrix of shards 1..N with fail-fast off, and each leg runs --shard=<its shard>/N (mutation: `fail-fast: true`, or shard list [1, 2, 3] → FAILS)", () => {
    const lines = job("e2e-shard");
    const at = lines.findIndex((l) => /^ {4}strategy:\s*$/.test(l));
    expect(at).toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (l.trim() !== "" && !/^ {6}/.test(l)) break;
      if (l.trim()) block.push(l.trim());
    }
    expect(block).toEqual(["fail-fast: false", "matrix:", `shard: [${Array.from({ length: SHARDS }, (_, i) => i + 1).join(", ")}]`]);
  });

  // The docs-only gate. A docs-only push must still END each required check
  // `success` on the head SHA, so the decision is a step, never a job-level
  // `if:` (asserted above) and never a workflow path filter (asserted here).
  // GitHub's docs: a workflow skipped by path filtering leaves its checks
  // "Pending" and a PR that requires them "will be blocked from merging";
  // a job skipped by `if:` reads `skipped`, which the gate refuses.
  it("the workflow has no path, branch or tag filter, so every push gets both required checks (mutation: `paths-ignore: ['**/*.md']` under push → FAILS)", () => {
    const on = topLevelBlock(ciLines, "on").map((l) => l.trim()).filter(Boolean);
    expect(on).toEqual(["push:", "workflow_dispatch:"]);
  });

  it.each(PARTS)("%s decides docs-only third, right after the guard, on no condition of its own (mutation: give the decision step an `if:` → FAILS)", (id) => {
    const third = steps(job(id))[2];
    expect(third?.run).toBe(SCOPE);
    expect(third?.id).toBe("scope");
    expect([...(third?.keys ?? [])].sort()).toEqual(["id", "name", "run"]);
  });

  it.each(PARTS)("%s skips nothing up to the decision, and every step after it on exactly the docs-only condition (mutation: drop the `if:` from one later step, or reword it to `== 'false'` → FAILS)", (id) => {
    const all = steps(job(id));
    const decision = all.findIndex((s) => s.run === SCOPE);
    expect(decision).toBe(2);
    // Checkout, the target guard and the decision itself always run: the
    // guard refuses a production target whether or not anything follows it.
    expect(all.slice(0, decision + 1).filter((s) => s.keys.includes("if"))).toEqual([]);
    // The stack diagnostics carry their own conditions, pinned in their own case.
    const after = all.slice(decision + 1).filter((s) => !isDiagnostic(s));
    expect(after.length).toBeGreaterThan(0);
    // `!= 'true'`, never `== 'false'`: when the decision writes nothing (a
    // crash, a renamed output), the condition still holds and the suites RUN.
    // The default is the full run.
    expect(after.map((s) => s.if)).toEqual(after.map(() => DOCS_ONLY_IF));
  });

  it("the docs-only condition guards the Supabase-touching commands themselves: the stacks, the types check, the db suite, the live web tests, the migration check, ci:seed and Playwright (mutation: drop the seed step's `if:`, or `if: always()` on the db suite → FAILS)", () => {
    const guarded = (id: string, run: string) => {
      const all = steps(job(id));
      const at = all.findIndex((s) => s.run === run);
      expect(at, `${id}: ${run}`).toBeGreaterThan(all.findIndex((s) => s.run === SCOPE));
      expect(all[at]?.if, `${id}: ${run}`).toBe(DOCS_ONLY_IF);
    };
    guarded("verify-db", START_STACK);
    guarded("verify-db", DB_TESTS);
    guarded("verify-db", WEB_LIVE_TESTS);
    guarded("verify-db", TYPES_CHECK);
    guarded("e2e-migrations", MIGRATIONS_APPLIED);
    guarded("migrations-plan", MIGRATIONS_PLAN);
    guarded("e2e-shard", `${START_STACK} --trust-clerk-dev-instance`);
    guarded("e2e-shard", SEED_LOCAL);
    guarded("e2e-shard", PLAYWRIGHT);
  });

  it("only verify-db and e2e-shard start a stack (mutation: start one in verify-app → FAILS)", () => {
    const starts = Object.keys(ciJobs).filter((id) =>
      steps(job(id)).some((s) => s.run?.startsWith(START_STACK)));
    expect(starts.sort()).toEqual([...STACK_PARTS].sort());
  });

  // e2e left the shared project on 2026-10-08 and verify the same day; since
  // then no two runs share a database, so no job joins a repo-wide group. The
  // shards (2026-11-12) are four more runs side by side: each mints its own
  // Clerk users with Date.now() stamps, and the sweep deletes only what is 30
  // minutes old (e2e/fixtures/stale.ts), so a shard never touches another's.
  it.each(Object.keys(ciJobs))("%s joins no job-level concurrency group (mutation: re-add `group: e2e-ci-supabase` → FAILS)", (id) => {
    expect(jobKeys(job(id))).not.toContain("concurrency");
    expect(job(id).filter((l) => /^\s+(group|queue|cancel-in-progress):/.test(l))).toEqual([]);
  });

  it("a newer push supersedes only ITS OWN branch's older run, and a run on main is never superseded (mutation: group `ci-${{ github.ref }}` → main's runs replace each other → FAILS; cancel-in-progress `true` → FAILS)", () => {
    // Workflow level, one group per branch ref, cancelling: a second push to
    // a branch stops that branch's stale run (and the Supabase traffic it was
    // making); another branch's ref is another group. On main, every run is
    // its own group (the run id) and nothing cancels it: main's run is the
    // checked state of the commit being deployed.
    const top = mapping(topLevelBlock(ciLines, "concurrency"));
    expect(top.group).toBe("ci-${{ github.ref == 'refs/heads/main' && github.run_id || github.ref }}");
    expect(top["cancel-in-progress"]).toBe("${{ github.ref != 'refs/heads/main' }}");
    expect(Object.keys(top).sort()).toEqual(["cancel-in-progress", "group"]);
  });
});

// `pnpm check` is CLAUDE.md's first gate, and until 2026-11-12 verify ran it
// verbatim, so a terminal and CI could not disagree about "green". verify now
// runs it in two parallel parts, so this pins that the parts together are
// EXACTLY `pnpm check`: the root's recursive typecheck and lint, and every
// workspace package's whole test suite, the web suite as its two vitest
// projects, which partition it (vitest.config.ts). A new package with a
// `test` script that CI does not run is red here, not silently missing.
describe("verify's parts run exactly what `pnpm check` runs", () => {
  const ROOT = new URL("../../../", import.meta.url);
  const rootPkg = JSON.parse(read("../../../package.json")) as { scripts: Record<string, string> };
  const verifyRuns = () => GATES.verify.flatMap((id) => steps(job(id)).flatMap((s) => (s.run ? [s.run] : [])));

  /** Every workspace package: each `dir/*` glob in pnpm-workspace.yaml, expanded. */
  const workspace = read("../../../pnpm-workspace.yaml").split("\n")
    .flatMap((l) => /^\s*-\s*["']?([^"'\s]+)\/\*["']?\s*$/.exec(l)?.[1] ?? [])
    .flatMap((dir) => fs.readdirSync(fileURLToPath(new URL(`${dir}/`, ROOT)))
      .map((name) => fileURLToPath(new URL(`${dir}/${name}/package.json`, ROOT)))
      .filter((p) => fs.existsSync(p)))
    .map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as { name: string; scripts?: Record<string, string> });

  it("finds the workspace's packages (the parser is not reading nothing)", () => {
    expect(workspace.map((p) => p.name)).toEqual(expect.arrayContaining(["@bis/db", "web"]));
  });

  it("`pnpm check` is still the root's typecheck, lint and test, each recursive over the workspace", () => {
    expect(rootPkg.scripts.check).toBe("pnpm typecheck && pnpm lint && pnpm test");
    expect(rootPkg.scripts.typecheck).toBe("pnpm -r --if-present typecheck");
    expect(rootPkg.scripts.lint).toBe("pnpm -r --if-present lint");
    expect(rootPkg.scripts.test).toBe("pnpm -r --if-present test");
  });

  it("verify runs the root's typecheck and lint, which cover every package by themselves (mutation: `pnpm --filter web typecheck` instead → FAILS)", () => {
    expect(verifyRuns()).toContain("pnpm typecheck");
    expect(verifyRuns()).toContain("pnpm lint");
  });

  it("web's test script is plain `vitest run`, so its projects are its whole suite", () => {
    const web = workspace.find((p) => p.name === "web");
    expect(web?.scripts?.test).toBe("vitest run");
  });

  it("verify runs every package's whole test suite, web's as each of its vitest projects, and no test command of any other shape (mutation: drop `pnpm --filter web test --project live`, or add a package with a test script → FAILS)", async () => {
    const webConfig = (await import("../vitest.config")).default as { test?: { projects?: Array<{ test?: { name?: string } }> } };
    const webProjects = (webConfig.test?.projects ?? []).map((p) => p.test?.name);
    expect(webProjects).toEqual(["unit", "live"]);
    const expected = workspace.filter((p) => p.scripts?.test).flatMap((p) =>
      p.name === "web"
        ? webProjects.map((project) => `pnpm --filter web test --project ${project}`)
        : [`pnpm --filter ${p.name} test`]);
    const testRuns = verifyRuns().filter((r) => /^pnpm (--filter \S+ )?test(\s|$)/.test(r));
    expect([...testRuns].sort()).toEqual([...expected].sort());
  });
});

// This repository is PUBLIC, and so is every Actions artifact it publishes:
// any signed-in GitHub user can download one. A Playwright trace records the
// browser's network traffic, cookies and storage — a Clerk session for the
// dev instance and whatever the database rendered — and the storage-state
// files under e2e/.auth and screenshots/.auth ARE sessions. Until 2026-10-07
// ci.yml's e2e job and screenshots.yml both uploaded apps/web/test-results/
// (where Playwright writes trace.zip) on every failure; 13 such artifacts
// were deleted by hand that day. Traces are now local-only: a failed run
// locally leaves them in apps/web/test-results/.
//
// These cases read EVERY workflow, not just ci.yml, because the next upload
// can arrive in any of them.
describe("no workflow publishes Playwright traces, sessions or build output as an artifact", () => {
  const workflowDir = new URL("../../../.github/workflows/", import.meta.url);
  const workflowFiles = fs.readdirSync(fileURLToPath(workflowDir))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();

  type Upload = { file: string; name: string; paths: string[] };

  /**
   * Every upload-artifact step in one workflow, with its `with: name` and
   * every entry of its `with: path` (one-line or a `|` block). A step is the
   * lines from its `- ` dash up to the next line at or left of that dash.
   */
  function uploads(file: string, text: string): Upload[] {
    const lines = codeLines(text);
    const out: Upload[] = [];
    for (let i = 0; i < lines.length; i++) {
      const dash = /^(\s*)- /.exec(lines[i]!);
      if (!dash) continue;
      const indent = dash[1]!.length;
      const rest = lines.slice(i + 1);
      const end = rest.findIndex((l) => l.trim() !== "" && l.search(/\S/) <= indent);
      const block = [lines[i]!, ...(end < 0 ? rest : rest.slice(0, end))];
      if (!block.some((l) => /^\s*(- )?uses:\s*\S*upload-artifact@/.test(l))) continue;
      let name = "";
      const paths: string[] = [];
      block.forEach((line, j) => {
        const nameMatch = /^\s+name:\s*(.+)$/.exec(line);
        if (nameMatch && j > 0 && block.slice(0, j).some((l) => /^\s+with:\s*$/.test(l))) {
          name = nameMatch[1]!.trim();
        }
        const pathMatch = /^(\s+)path:\s*(.*)$/.exec(line);
        if (!pathMatch) return;
        const value = pathMatch[2]!.trim();
        if (value && value !== "|" && value !== ">") {
          paths.push(value);
          return;
        }
        const keyIndent = pathMatch[1]!.length;
        for (const next of block.slice(j + 1)) {
          if (next.trim() !== "" && next.search(/\S/) <= keyIndent) break;
          if (next.trim()) paths.push(next.trim());
        }
      });
      out.push({ file, name, paths });
    }
    return out;
  }

  const all = workflowFiles.flatMap((f) => uploads(f, read(`../../../.github/workflows/${f}`)));

  it("finds the workflows and the uploads it is guarding (the parser is not reading nothing)", () => {
    expect(workflowFiles).toEqual(expect.arrayContaining(["ci.yml", "screenshots.yml", "ci-project-setup.yml"]));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((u) => u.paths.length > 0)).toBe(true);
  });

  it("ci.yml uploads no artifact at all (mutation: re-add the e2e job's `playwright-traces` upload of apps/web/test-results/ → FAILS)", () => {
    expect(all.filter((u) => u.file === "ci.yml")).toEqual([]);
  });

  it("no upload-artifact step's name or path names traces, test-results, a Playwright report, auth/storage state, .next or an env file (mutation: re-add screenshots.yml's `screenshot-traces` upload → FAILS)", () => {
    const forbidden = /trace|test-results|playwright-report|\.auth|storage|\.next|\.env/i;
    const offenders = all.filter((u) => forbidden.test(u.name) || u.paths.some((p) => forbidden.test(p)));
    expect(offenders).toEqual([]);
  });

  it("uploads only the three artifacts reviewed as safe to publish (a new upload must be added here, on purpose, with its reason)", () => {
    // demo-screenshots: PNG pixels of the seeded, outbound-suppressed demo
    //   tenant, made FOR the public marketing site. The session that took them
    //   lives in screenshots/.auth/, outside this directory.
    // ci-project-<step>: catalog rows (schema, policies, grants, bucket
    //   settings, migration names) of the CI project, all of which the public
    //   migrations already spell out.
    // sofia-corpus-<run>: ONE file, the corpus transcripts encrypted to the
    //   owner's certificate (openssl cms, AES-256). Anyone can download it;
    //   only the private key on the owner's machine opens it. The plaintext
    //   folder is never a path here (pinned in the sofia-corpus.yml block).
    expect(all.map((u) => `${u.file} ${u.paths.join(",")}`).sort()).toEqual([
      "ci-project-setup.yml ${{ runner.temp }}/ci-project-setup/${{ inputs.step }}.tsv",
      "screenshots.yml apps/web/screenshots/out/",
      "sofia-corpus.yml ${{ runner.temp }}/sofia-corpus-upload/sofia-corpus-${{ github.run_id }}-${{ github.run_attempt }}.cms",
    ]);
  });
});

// ci-project-setup.yml runs ONE physical step for every dispatch value
// (bootstrap, push, migrations, the three read-only parity queries, seed),
// picked at runtime by a shell `case "$STEP" in`. Of those, only `seed`
// (packages/db/src/ci-seed/run.ts) calls serviceDb(), which is the only
// runner that reads SUPABASE_SERVICE_ROLE_KEY — every other case
// authenticates with SUPABASE_DB_URL alone (packages/db/src/ci/target.ts,
// sql.ts, push.ts). Setting the real secret unconditionally on that one
// physical step handed it to a runner that never reads it on six of the
// seven dispatch values (#131 review). These cases pin that the secret is
// scoped to the `seed` dispatch instead of every dispatch.
describe("ci-project-setup.yml scopes the service-role secret to the dispatch that reads it", () => {
  const setupLines = codeLines(read("../../../.github/workflows/ci-project-setup.yml"));

  /**
   * A step's own raw lines, found by its exact (trimmed) `- name:`/`- uses:`
   * line, running up to the next dash at the SAME indent (or EOF). Comment
   * lines are already gone (`codeLines`), so a step named only in a comment
   * cannot be found this way.
   */
  function stepBlock(lines: string[], dashLine: string): string[] {
    const start = lines.findIndex((l) => l.trim() === dashLine);
    if (start < 0) throw new Error(`ci-project-setup.yml has no step "${dashLine}"`);
    const dashIndent = lines[start]!.search(/\S/);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^\s*-\s/.test(l) && l.search(/\S/) === dashIndent);
    return end < 0 ? rest : rest.slice(0, end);
  }

  /** `KEY: value` pairs directly under a step's own nested `env:` mapping. */
  function stepEnv(block: string[]): Record<string, string> {
    const at = block.findIndex((l) => /^\s*env:\s*$/.test(l));
    if (at < 0) throw new Error("step has no env: block");
    const envIndent = block[at]!.search(/\S/);
    const out: Record<string, string> = {};
    for (const line of block.slice(at + 1)) {
      const indent = line.search(/\S/);
      if (line.trim() !== "" && indent <= envIndent) break;
      const m = /^\s*([A-Za-z0-9_]+): (.+)$/.exec(line);
      if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
    }
    return out;
  }

  const runStepEnv = stepEnv(stepBlock(setupLines, "- name: Run ${{ inputs.step }}"));
  const preflightStepEnv = stepEnv(
    stepBlock(setupLines, "- name: Check that the CI project secrets are configured"),
  );

  it(
    "hands the real secret to a `seed` dispatch only, and an empty string to every other " +
    "dispatch (mutation: SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.CI_SUPABASE_SECRET_KEY }}, " +
    "unconditional → FAILS)",
    () => {
      expect(runStepEnv.SUPABASE_SERVICE_ROLE_KEY).toBe(
        "${{ inputs.step == 'seed' && secrets.CI_SUPABASE_SECRET_KEY || '' }}",
      );
    },
  );

  it("still hands SUPABASE_DB_URL to every dispatch — every case authenticates with it", () => {
    expect(runStepEnv.SUPABASE_DB_URL).toBe("${{ secrets.CI_SUPABASE_DB_URL }}");
  });

  it(
    "the secrets pre-flight step tests the service-role secret via a boolean, never its real " +
    "value (mutation: SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.CI_SUPABASE_SECRET_KEY }} → FAILS)",
    () => {
      expect(preflightStepEnv.HAS_SERVICE_KEY).toBe("${{ secrets.CI_SUPABASE_SECRET_KEY != '' }}");
      expect(preflightStepEnv.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    },
  );

  it("still names the missing secret when the boolean is false", () => {
    const block = stepBlock(setupLines, "- name: Check that the CI project secrets are configured");
    const text = block.join("\n");
    expect(text).toMatch(/"\$HAS_SERVICE_KEY" != "true"/);
    expect(text).toContain("CI_SUPABASE_SECRET_KEY");
  });

  /**
   * The line RANGE (start index inclusive, end index exclusive, into
   * `setupLines`) covered by one step, found the same way `stepBlock` finds
   * its body — but returned as indices rather than copied lines, so an
   * occurrence elsewhere in the file can be tested for membership without a
   * content comparison (two steps can share an identical line).
   */
  function stepLineRange(lines: string[], dashLine: string): [number, number] {
    const start = lines.findIndex((l) => l.trim() === dashLine);
    if (start < 0) throw new Error(`ci-project-setup.yml has no step "${dashLine}"`);
    const dashIndent = lines[start]!.search(/\S/);
    const rest = lines.slice(start + 1);
    const relEnd = rest.findIndex((l) => /^\s*-\s/.test(l) && l.search(/\S/) === dashIndent);
    const end = relEnd < 0 ? lines.length : start + 1 + relEnd;
    return [start, end];
  }

  it(
    "references secrets.CI_SUPABASE_SECRET_KEY only inside the two steps that need it — never in " +
    "workflow-level env, job-level env, or any other step (mutation B: add " +
    "`SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.CI_SUPABASE_SECRET_KEY }}` to the workflow-level " +
    "`env:` block → FAILS; mutation C: add the same line to the `pnpm install --frozen-lockfile` " +
    "step's own `env:` → FAILS)",
    () => {
      const [preflightStart, preflightEnd] = stepLineRange(
        setupLines, "- name: Check that the CI project secrets are configured",
      );
      const [runStart, runEnd] = stepLineRange(setupLines, "- name: Run ${{ inputs.step }}");
      const offenders = setupLines.flatMap((line, i) => {
        if (!line.includes("secrets.CI_SUPABASE_SECRET_KEY")) return [];
        const inPreflight = i >= preflightStart && i < preflightEnd;
        const inRun = i >= runStart && i < runEnd;
        return inPreflight || inRun ? [] : [line.trim()];
      });
      expect(offenders).toEqual([]);
    },
  );
});

// Production credentials live in a GitHub Environment named `production`
// whose deployment branch policy admits `main` only, never as repository-wide
// secrets. A job can read an environment's secrets only by declaring
// `environment: production`, and GitHub refuses that declaration on any other
// ref, so a workflow edited on a branch cannot reach them. These cases read
// EVERY workflow: each secret it names must be classified below on purpose,
// each job that names a production secret must declare the environment, and
// no job may declare it without needing it (the CI gates least of all).
describe("production secrets are reachable only from jobs that declare the production environment", () => {
  /** The secrets that open production: they live in the `production` environment only. */
  const PRODUCTION_SECRETS = new Set([
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "OPS_HEALTH_SECRET",
  ]);
  /**
   * Everything else a workflow may read, and why it is not production's: the
   * CI_* secrets open the `bis-ci` project; the two Clerk keys are the
   * development instance's (ci-target-guard.sh refuses pk_live_/sk_live_);
   * OPENAI_API_KEY is the separate, revocable CI key.
   */
  const NON_PRODUCTION_SECRETS = new Set([
    "CI_SUPABASE_SECRET_KEY", "CI_SUPABASE_DB_URL", "CI_STRIPE_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "OPENAI_API_KEY",
  ]);
  const DECLARES_PRODUCTION = /^ {4}environment: production\s*$/;

  const workflowDir = new URL("../../../.github/workflows/", import.meta.url);
  const workflows = fs.readdirSync(fileURLToPath(workflowDir))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => ({ file, lines: codeLines(read(`../../../.github/workflows/${file}`)) }));

  /**
   * The parts of a line GitHub evaluates as an expression, where the secrets
   * context can be read: every `${{ … }}`, and a bare `if:` value. Prose such
   * as a step named "Check that the repository secrets are configured" is
   * neither, so it is not mistaken for a read.
   */
  function expressions(line: string): string[] {
    const wrapped = [...line.matchAll(/\$\{\{(.*?)\}\}/g)].map((m) => m[1] ?? "");
    const bareIf = /^\s*(?:- )?if:\s*(.+)$/.exec(line)?.[1];
    return bareIf && wrapped.length === 0 ? [bareIf] : wrapped;
  }

  /** Every `secrets.X` name on some lines, and every expression mention of the context that is not that shape. */
  function secretMentions(lines: string[]): { names: string[]; malformed: string[] } {
    const names: string[] = [];
    const malformed: string[] = [];
    for (const line of lines) {
      for (const m of expressions(line).flatMap((e) => [...e.matchAll(/\bsecrets\b(\.[A-Za-z0-9_]+)?/gi)])) {
        if (m[0].slice(0, 8) === "secrets." && m[1]) names.push(m[1].slice(1));
        else malformed.push(line.trim());
      }
    }
    return { names, malformed };
  }

  type JobInfo = { where: string; production: string[]; declares: boolean; anyEnvironment: boolean };
  const allJobs: JobInfo[] = workflows.flatMap(({ file, lines }) =>
    Object.entries(jobs(lines)).map(([id, jobLines]) => ({
      where: `${file}:${id}`,
      production: secretMentions(jobLines).names.filter((n) => PRODUCTION_SECRETS.has(n)),
      declares: jobLines.some((l) => DECLARES_PRODUCTION.test(l)),
      anyEnvironment: jobKeys(jobLines).includes("environment"),
    })));

  it("finds the workflows and jobs it is guarding (the parser is not reading nothing)", () => {
    expect(workflows.map((w) => w.file)).toEqual(
      expect.arrayContaining(["ci.yml", "ops-health.yml", "screenshots.yml", "seed-demo.yml"]));
    expect(allJobs.map((j) => j.where)).toEqual(expect.arrayContaining([
      "ci.yml:verify", "ci.yml:e2e", "ops-health.yml:check", "screenshots.yml:capture", "seed-demo.yml:seed",
    ]));
    // Exactly these, so a job that starts or stops reading production shows
    // up here. screenshots.yml:capture left this list on 2026-10-08 (#197):
    // it captures on the CI project now.
    expect(allJobs.filter((j) => j.production.length > 0).map((j) => j.where).sort())
      .toEqual(["ops-health.yml:check", "seed-demo.yml:seed"]);
  });

  it("names every secret by `secrets.NAME`, and every NAME is classified here on purpose (a new secret must be added to one of the two sets, with its reason)", () => {
    const unclassified = workflows.flatMap(({ file, lines }) => {
      const { names, malformed } = secretMentions(lines);
      return [
        ...names.filter((n) => !PRODUCTION_SECRETS.has(n) && !NON_PRODUCTION_SECRETS.has(n)).map((n) => `${file}: ${n}`),
        ...malformed.map((l) => `${file}: ${l}`),
      ];
    });
    expect(unclassified).toEqual([]);
  });

  it("names no production secret outside a job, where no environment can scope it (mutation: put `SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` in seed-demo.yml's top-level env → FAILS)", () => {
    const outside = workflows.flatMap(({ file, lines }) => {
      const jobsAt = lines.indexOf("jobs:");
      const before = jobsAt < 0 ? lines : lines.slice(0, jobsAt);
      return secretMentions(before).names.filter((n) => PRODUCTION_SECRETS.has(n)).map((n) => `${file}: ${n}`);
    });
    expect(outside).toEqual([]);
  });

  it("every job that names a production secret declares `environment: production` (mutation: drop it from ops-health.yml's check job → FAILS)", () => {
    const undeclared = allJobs.filter((j) => j.production.length > 0 && !j.declares).map((j) => j.where);
    expect(undeclared).toEqual([]);
  });

  it("no job declares the production environment without naming a production secret (mutation: add `environment: production` to ci-project-setup.yml's setup job → FAILS)", () => {
    const needless = allJobs.filter((j) => j.declares && j.production.length === 0).map((j) => j.where);
    expect(needless).toEqual([]);
  });

  // Every ci.yml job since 2026-11-12: the gates and each of their parts.
  it("no ci.yml job, the verify and e2e gates and their parts included, declares an environment or names a production secret (mutation: add `environment: production` to e2e-shard, or `OPS_HEALTH_SECRET: ${{ secrets.OPS_HEALTH_SECRET }}` to its env → FAILS)", () => {
    const gates = allJobs.filter((j) => j.where.startsWith("ci.yml:"));
    expect(gates.map((j) => j.where)).toEqual(expect.arrayContaining(
      ["verify", "e2e", ...PARTS].map((id) => `ci.yml:${id}`)));
    expect(gates.filter((j) => j.anyEnvironment || j.production.length > 0).map((j) => j.where)).toEqual([]);
    expect(secretMentions(ciLines).names.filter((n) => PRODUCTION_SECRETS.has(n))).toEqual([]);
  });
});

/**
 * The production demo rebuilds itself every morning, with a backup run an
 * hour later (owner's decisions, 2026-10-13 and 2026-10-19): left alone,
 * every date in it is frozen at its seed. The first scheduled Monday run was
 * dropped by GitHub without a trace, hence the backup, which must skip when
 * the demo is already fresh and must rebuild otherwise. A schedule has no
 * inputs, so the "type seed" check skips it, and only it; a dispatch still
 * needs the word. And still no push trigger, ever.
 */
describe("seed-demo.yml rebuilds the production demo every morning, with a backup, and only by schedule or a typed dispatch", () => {
  const seedLines = codeLines(read("../../../.github/workflows/seed-demo.yml"));
  const text = seedLines.join("\n");

  it("keeps two backup schedules after Vercel's 10:17 dispatch (mutation: drop either cron -> FAILS)", () => {
    expect(text).toMatch(/schedule:\s*\n\s*- cron: '17 11 \* \* \*'\s*\n\s*- cron: '17 13 \* \* \*'/);
  });

  it("never runs on a push or pull request (mutation: add `push:` -> FAILS)", () => {
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\nconcurrency:"));
    expect(on).not.toMatch(/^\s*(push|pull_request\w*):/m);
  });

  it("skips the typed confirmation for the schedule only (mutation: drop the `if:` -> FAILS)", () => {
    expect(text).toMatch(/- name: Check the confirmation\s*\n\s*if: github\.event_name == 'workflow_dispatch'/);
    expect(text).toMatch(/inputs\.confirm \}\}" != "seed"/);
  });

  it("lets only a scheduled run skip, and only on a demo under six hours old; a dispatch always rebuilds (mutation: guard dispatches too -> FAILS)", () => {
    expect(text).toMatch(/id: fresh\s*\n\s*if: github\.event_name == 'schedule'\s*\n/);
    expect(text).toMatch(/-lt 21600/);
  });

  it("gates the seed itself on that check (mutation: drop the Seed step's `if:` -> FAILS)", () => {
    expect(text).toMatch(/- name: Seed\s*\n\s*if: steps\.fresh\.outputs\.skip != 'true'/);
    expect(text).toMatch(/- run: pnpm install --frozen-lockfile\s*\n\s*if: steps\.fresh\.outputs\.skip != 'true'/);
  });
});

/**
 * sofia-corpus.yml (S-47b) plays Sofía's test corpus against OpenAI with the
 * repository's OPENAI_API_KEY, so the owner never handles the key. The
 * repository is PUBLIC: its run logs and artifacts are readable by anyone. So
 * the workflow is pinned to the narrowest shape it can have: a dispatch by
 * hand and nothing else, the one secret on the one step that runs the tool,
 * no database or auth value of any kind, dispatch inputs reaching the shell
 * through env only, and one upload, the transcripts sealed to the owner's
 * certificate by .github/scripts/sofia-corpus-seal.sh (tested for real in
 * sofia-corpus-seal.test.ts).
 */
describe("sofia-corpus.yml runs by hand only, holds the OpenAI key on one step, and publishes only a sealed file", () => {
  const corpusLines = codeLines(read("../../../.github/workflows/sofia-corpus.yml"));
  const corpusJobs = jobs(corpusLines);
  const runJob = corpusJobs.run;
  if (!runJob) throw new Error('sofia-corpus.yml has no job "run"');
  const corpusSteps = steps(runJob);
  const SEAL = "bash .github/scripts/sofia-corpus-seal.sh";

  /** Each step's own raw lines (from its dash to the next dash at the same indent). */
  function stepBlocks(jobLines: string[]): string[][] {
    const at = jobLines.findIndex((l) => /^\s+steps:\s*$/.test(l));
    const body = jobLines.slice(at + 1);
    const dashIndent = body.find((l) => /^\s*- /.test(l))!.search(/\S/);
    const out: string[][] = [];
    for (const line of body) {
      if (/^\s*- /.test(line) && line.search(/\S/) === dashIndent) out.push([line]);
      else out[out.length - 1]?.push(line);
    }
    return out;
  }
  const blocks = stepBlocks(runJob);
  /** `NAME: value` pairs under one step's own `env:`. */
  function blockEnv(block: string[]): Record<string, string> {
    const at = block.findIndex((l) => /^\s+env:\s*$/.test(l));
    if (at < 0) return {};
    const envIndent = block[at]!.search(/\S/);
    const out: Record<string, string> = {};
    for (const line of block.slice(at + 1)) {
      if (line.trim() !== "" && line.search(/\S/) <= envIndent) break;
      const m = /^\s+([A-Za-z0-9_]+): (.+)$/.exec(line);
      if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
    }
    return out;
  }
  const toolBlock = blocks.find((b) => b[0]!.trim() === "- name: Run ${{ inputs.step }}");

  it("is triggered by workflow_dispatch and nothing else (mutation: add `push:` or `schedule:` under on → FAILS)", () => {
    const triggers = topLevelBlock(corpusLines, "on").flatMap((l) => /^ {2}([A-Za-z_]+):/.exec(l)?.[1] ?? []);
    expect(triggers).toEqual(["workflow_dispatch"]);
  });

  it("takes exactly the five inputs: step, module, phone_engine, only and repeat", () => {
    const on = topLevelBlock(corpusLines, "on");
    const inputs = on.flatMap((l) => /^ {6}([A-Za-z_]+):\s*$/.exec(l)?.[1] ?? []);
    expect(inputs).toEqual(["step", "module", "phone_engine", "only", "repeat"]);
  });

  // S-47b v3 (C): each item played three times by default, so a rule that held once by luck shows as a split.
  it("repeat is a choice of 1 or 3, default 3, reaching the runner through the tool step's env and checked again in bash (mutation: default 1, or `--repeat ${{ inputs.repeat }}` -> FAILS)", () => {
    const on = topLevelBlock(corpusLines, "on");
    const at = on.findIndex((l) => /^ {6}repeat:\s*$/.test(l));
    const block: string[] = [];
    for (const l of on.slice(at + 1)) { if (/^ {6}\S/.test(l)) break; if (l.trim()) block.push(l.trim()); }
    expect(block).toContain("type: choice");
    expect(block).toContain('default: "3"');
    expect(block.slice(block.indexOf("options:") + 1)).toEqual(['- "1"', '- "3"']);
    expect(blockEnv(toolBlock!).REPEAT).toBe("${{ inputs.repeat }}");
    const script = toolBlock!.join("\n");
    expect(script).toContain('case "$REPEAT" in');
    expect(script).toContain('1|3) ;;');
    expect(script).toContain('pnpm --silent --filter web sofia:corpus "$m" --phone-engine "$PHONE_ENGINE" --repeat "$REPEAT" "${only_args[@]}" || failed=1');
  });

  it("reads the repository with contents: read only, and queues its runs without ever cancelling one", () => {
    expect(topLevelBlock(corpusLines, "permissions").map((l) => l.trim()).filter(Boolean)).toEqual(["contents: read"]);
    expect(mapping(topLevelBlock(corpusLines, "concurrency"))).toEqual({ group: "sofia-corpus", "cancel-in-progress": "false" });
  });

  it("names one secret, OPENAI_API_KEY, on exactly one line: the tool step's own env (mutation: move it to a job- or workflow-level env → FAILS)", () => {
    const mentions = corpusLines.filter((l) => /secrets/i.test(l)).map((l) => l.trim());
    expect(mentions).toEqual(["OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}"]);
    expect(toolBlock, "no step named `Run ${{ inputs.step }}`").toBeDefined();
    expect(blockEnv(toolBlock!).OPENAI_API_KEY).toBe("${{ secrets.OPENAI_API_KEY }}");
    expect(corpusLines.some((l) => /^env:/.test(l))).toBe(false);
    expect(jobEnv(runJob)).toEqual({});
  });

  it("carries no Supabase, Postgres, Clerk or database value, and declares no environment (mutation: add `SUPABASE_DB_URL: …` or `environment: production` → FAILS)", () => {
    const offenders = corpusLines.filter((l) =>
      /supabase|clerk|DB_URL|DATABASE|\bPG(HOST|USER|PASSWORD|DATABASE|PORT)\b|environment:/i.test(l));
    expect(offenders).toEqual([]);
    expect(corpusLines.join("\n")).not.toContain(PROD_REF);
  });

  it("never interpolates an expression into a shell script: dispatch inputs reach bash through env only (mutation: `--only ${{ inputs.only }}` inside run → FAILS)", () => {
    const interpolated: string[] = [];
    corpusLines.forEach((line, i) => {
      const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
      if (!m) return;
      const indent = m[1]!.length;
      const value = m[2]!.trim();
      if (value !== "|" && value !== ">") {
        if (value.includes("${{")) interpolated.push(line.trim());
        return;
      }
      for (const next of corpusLines.slice(i + 1)) {
        if (next.trim() !== "" && next.search(/\S/) <= indent + (line.trimStart().startsWith("- ") ? 2 : 0)) break;
        if (next.includes("${{")) interpolated.push(next.trim());
      }
    });
    expect(interpolated).toEqual([]);
    // The one free-text input is checked before it is used.
    expect(toolBlock!.join("\n")).toContain('[[ "$ONLY" =~ ^[0-9]{1,2}$ ]]');
  });

  it("seals the transcripts to the committed certificate, pinned by fingerprint, after the tool runs, even when an item failed", () => {
    const toolAt = toolBlock ? blocks.indexOf(toolBlock) : -1;
    const sealAt = corpusSteps.findIndex((s) => s.run?.startsWith(SEAL));
    expect(toolAt).toBeGreaterThanOrEqual(0);
    expect(sealAt).toBeGreaterThan(toolAt);
    expect(corpusSteps[sealAt]!.id).toBe("seal");
    expect(corpusSteps[sealAt]!.if).toBe("${{ !cancelled() && inputs.step == 'corpus' }}");
    // The fifth argument is the certificate's SHA-256 pin (sofia-corpus-seal.test.ts checks it IS the committed certificate's).
    expect(corpusSteps[sealAt]!.run).toBe(
      `${SEAL} apps/web/.sofia-corpus "$RUNNER_TEMP/sofia-corpus-upload" "sofia-corpus-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" .github/sofia-corpus-recipient.pem ` +
      "3A:6A:8F:8F:74:82:B0:F0:F0:B3:6E:12:ED:98:6F:95:C6:16:BC:D5:AC:76:78:9E:3F:5A:63:4E:32:61:7C:05");
  });

  it("uploads only after the seal step SUCCEEDED, so a refused seal publishes nothing (mutation: back to `!cancelled() && inputs.step == 'corpus'` → FAILS)", () => {
    const sealAt = corpusSteps.findIndex((s) => s.run?.startsWith(SEAL));
    const uploadAt = corpusSteps.findIndex((s) => /upload-artifact@/.test(s.uses ?? ""));
    expect(uploadAt).toBeGreaterThan(sealAt);
    expect(corpusSteps[uploadAt]!.if).toBe(
      "${{ !cancelled() && inputs.step == 'corpus' && steps.seal.outcome == 'success' }}");
  });

  it("uploads one file, the sealed .cms, kept three days and failing loudly when missing (mutation: path apps/web/.sofia-corpus/ → FAILS)", () => {
    const upload = blocks.find((b) => b.some((l) => /uses:\s*\S*upload-artifact@/.test(l)));
    expect(upload).toBeDefined();
    const withKeys = mapping(upload!.flatMap((l) => {
      const m = /^ {10}([a-z-]+): (.+)$/.exec(l);
      return m ? [`  ${m[1]}: ${m[2]}`] : [];
    }));
    expect(withKeys).toEqual({
      name: "sofia-corpus-${{ github.run_id }}-${{ github.run_attempt }}",
      path: "${{ runner.temp }}/sofia-corpus-upload/sofia-corpus-${{ github.run_id }}-${{ github.run_attempt }}.cms",
      "if-no-files-found": "error",
      "retention-days": "3",
      "compression-level": "0",
    });
    expect(blocks.filter((b) => b.some((l) => /upload-artifact@/.test(l)))).toHaveLength(1);
  });

  it("pins every action it uses to a full commit SHA: a secret-bearing job runs no code a moved tag could swap in", () => {
    const uses = corpusSteps.flatMap((s) => s.uses ?? []);
    expect(uses.length).toBeGreaterThanOrEqual(4);
    expect(uses.filter((u) => !/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(u))).toEqual([]);
  });

  it("checks out without persisting the GitHub token", () => {
    const checkout = blocks.find((b) => b.some((l) => /uses:\s*actions\/checkout@/.test(l)));
    expect(checkout?.map((l) => l.trim())).toContain("persist-credentials: false");
  });
});
