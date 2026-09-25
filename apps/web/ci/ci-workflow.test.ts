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
type Step = { keys: string[]; uses?: string; run?: string };

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
    if ((key === "uses" || key === "run") && value) step[key] = value.trim();
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
    // Those three names still mean production for seed-demo.yml and
    // screenshots.yml. The CI project's credentials are the CI_* secrets.
    // Case-insensitive: GitHub resolves context properties regardless of case,
    // so `secrets.supabase_db_url` reads the same secret.
    const found = ciLines.filter((line) =>
      /secrets\.(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL)\b/i.test(line));
    expect(found).toEqual([]);
  });

  it("reads secrets only by name, and only the six it needs", () => {
    // `secrets['X']` and `toJSON(secrets)` reach a production secret without
    // ever writing `secrets.X`. So every mention of the secrets context must
    // be exactly `secrets.<one of these>`; anything else is listed.
    const allowed = new Set([
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY",
      "CI_SUPABASE_SECRET_KEY", "CI_SUPABASE_DB_URL", "OPENAI_API_KEY",
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

  it("maps the CI project's secrets onto the names the code reads", () => {
    expect(ciEnv.SUPABASE_SERVICE_ROLE_KEY).toBe("${{ secrets.CI_SUPABASE_SECRET_KEY }}");
    expect(ciEnv.SUPABASE_DB_URL).toBe("${{ secrets.CI_SUPABASE_DB_URL }}");
    expect(ciEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY).toMatch(/^sb_publishable_/);
  });

  it("hands the Stripe TEST key to the e2e job only, as STRIPE_SECRET_KEY (mutation: move it to the top-level env, or drop it → FAILS)", () => {
    expect(jobEnv(job("e2e")).STRIPE_SECRET_KEY).toBe("${{ secrets.CI_STRIPE_SECRET_KEY }}");
    expect(jobEnv(job("verify")).STRIPE_SECRET_KEY).toBeUndefined();
    expect(ciEnv.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("references secrets.CI_STRIPE_SECRET_KEY on exactly one non-comment line: e2e's own job-level env (mutation: also give a STEP inside verify its own `env: STRIPE_SECRET_KEY: ${{ secrets.CI_STRIPE_SECRET_KEY }}` — jobEnv only reads a job's 4-space env: block, so the two checks above stay green and this is the only one that FAILS)", () => {
    const matches = ciLines.filter((line) => line.includes("secrets.CI_STRIPE_SECRET_KEY"));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.trim()).toBe("STRIPE_SECRET_KEY: ${{ secrets.CI_STRIPE_SECRET_KEY }}");
    // The one occurrence is the same line jobEnv already found inside e2e's
    // own job-level env: block, not a second copy living on some step.
    expect(jobEnv(job("e2e")).STRIPE_SECRET_KEY).toBe("${{ secrets.CI_STRIPE_SECRET_KEY }}");
  });

  it("names the same CI project as the setup workflow that builds it, as a literal URL", () => {
    // The project ci-project-setup.yml bootstraps, pushes and seeds is the one
    // the gates must run on. A rebuilt project changes both files together.
    expect(setupEnv.BIS_CI_SUPABASE_REF).toMatch(/^[a-z0-9]{20}$/);
    expect(ciEnv.BIS_CI_SUPABASE_REF).toBe(setupEnv.BIS_CI_SUPABASE_REF);
    expect(ciEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(`https://${setupEnv.BIS_CI_SUPABASE_REF}.supabase.co`);
  });
});

describe("ci.yml's jobs", () => {
  it("keeps the job ids the main ruleset requires: verify and e2e", () => {
    expect(Object.keys(ciJobs)).toEqual(expect.arrayContaining(["verify", "e2e"]));
    expect(job("e2e").some((line) => /^\s+needs: verify\s*$/.test(line))).toBe(true);
  });

  it.each(["verify", "e2e"])("%s has no job-level name, if or continue-on-error", (id) => {
    // A `name:` renames the check run, so the ruleset's required `verify` /
    // `e2e` would never report. A job skipped by `if:` reports as skipped,
    // which does not block a merge. `continue-on-error` turns a red job green.
    const keys = jobKeys(job(id));
    expect(keys).toContain("steps"); // the parser found the job's own keys
    expect(keys.filter((k) => ["name", "if", "continue-on-error"].includes(k))).toEqual([]);
  });

  it.each(["verify", "e2e"])("%s runs the target guard straight after checkout, before anything else", (id) => {
    const [first, second] = steps(job(id));
    expect(first?.uses ?? "").toMatch(/^actions\/checkout@/);
    expect(second?.run).toBe(GUARD);
    // Nothing else on the step: an `if:` could skip it and a
    // `continue-on-error:` could let a refusal pass.
    expect([...(second?.keys ?? [])].sort()).toEqual(["name", "run"]);
  });

  it.each(["verify", "e2e"])("%s lets no step fail quietly or skip a command on a condition", (id) => {
    const all = steps(job(id));
    expect(all.length).toBeGreaterThan(3);
    expect(all.filter((s) => s.keys.includes("continue-on-error"))).toEqual([]);
    expect(all.filter((s) => s.run && s.keys.includes("if"))).toEqual([]);
  });

  it("verify runs exactly the guard, the install, pnpm check and the build, in that order", () => {
    const runs = steps(job("verify")).flatMap((s) => (s.run ? [s.run] : []));
    expect(runs).toEqual([GUARD, "pnpm install --frozen-lockfile", "pnpm check", "pnpm --filter web build"]);
  });

  it("e2e seeds the CI project after the install and before Playwright", () => {
    const runs = steps(job("e2e")).flatMap((s) => (s.run ? [s.run] : []));
    const install = runs.indexOf("pnpm install --frozen-lockfile");
    const seed = runs.indexOf("pnpm --filter @bis/db ci:seed");
    const playwright = runs.indexOf("pnpm --filter web test:e2e");
    expect(install, "install step").toBeGreaterThanOrEqual(0);
    expect(seed, "ci:seed step").toBeGreaterThan(install);
    expect(playwright, "Playwright step").toBeGreaterThan(seed);
  });

  it.each([
    ["verify", "verify-ci-supabase"],
    ["e2e", "e2e-ci-supabase"],
  ])("%s queues in its own CI-project group and is never cancelled", (id, group) => {
    const text = job(id).join("\n");
    expect(/^\s+group: (\S+)\s*$/m.exec(text)?.[1]).toBe(group);
    expect(/^\s+cancel-in-progress: (\S+)\s*$/m.exec(text)?.[1]).toBe("false");
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
