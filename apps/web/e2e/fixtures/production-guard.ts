/**
 * "Does this environment name production?" for apps/web's LIVE test runs:
 * the Playwright suite (playwright.config.ts, auth.setup.ts, sweep.setup.ts)
 * and the web unit tests that load apps/web/.env.local themselves.
 *
 * Why. CI runs on its own Supabase project behind
 * .github/scripts/ci-target-guard.sh. A local run reads apps/web/.env.local,
 * and on a machine whose env files have not been switched
 * (docs/runbooks/ci-supabase-project.md, section 9) that is production: the
 * e2e setup creates accounts, Clerk users and Storage objects there, the
 * fixture sweep deletes from it, and the specs write to it.
 *
 * It refuses production and nothing else. It does not require the CI
 * project: a developer's own project is allowed, and a run with no Supabase
 * values at all is left to the suite's own missing-credentials handling.
 *
 * Pure, and self-contained on purpose. The same check for packages/db lives
 * in packages/db/src/test/refuse-production.ts on top of
 * packages/db/src/ci/target.ts, which apps/web cannot import (@bis/db exports
 * only "." and "./search-term", and that file imports `pg`, which apps/web
 * does not depend on). So the ref is ONE constant per package, and
 * ./production-guard.test.ts fails if this one stops matching that one.
 *
 * Messages name VARIABLES, never values: a DB URL carries a password.
 */

/** Production's project ref. Pinned to packages/db/src/ci/target.ts's by test. */
export const PRODUCTION_SUPABASE_REF = "tlbkbmlrfafquucsmsmm";

function decodeOnce(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Production's ref anywhere in the value, case-insensitively, raw or
 * percent-decoded (up to three rounds, until it stops changing) — the same
 * rule as packages/db's `mentionsProduction`: `%74lbkb…` is production's ref
 * to every parser that decodes.
 */
function mentionsProduction(value: string): boolean {
  let current = value.toLowerCase();
  for (let round = 0; round < 4; round++) {
    if (current.includes(PRODUCTION_SUPABASE_REF)) return true;
    const next = decodeOnce(current).toLowerCase();
    if (next === current) return false;
    current = next;
  }
  return current.includes(PRODUCTION_SUPABASE_REF);
}

/**
 * A variable whose value can choose the database a run reaches: any name
 * containing SUPABASE, or a PG* default node-pg reads. Case-insensitive, as
 * Windows environment names are.
 */
function canPickTheDatabase(name: string): boolean {
  return /supabase/i.test(name) || /^pg/i.test(name);
}

const PRINTABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The variables in `env` that point at production, sorted. */
export function productionVariables(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => value !== undefined && canPickTheDatabase(name) && mentionsProduction(value))
    .map(([name]) => name)
    .sort();
}

export const REFUSAL_FIX =
  "Point apps/web/.env.local AND packages/db/.env at the CI project (or a project of your own) " +
  "as docs/runbooks/ci-supabase-project.md, section 9 describes, then run it again.";

/**
 * Throws when any database-choosing variable in `env` names production.
 * `suite` is a literal from the caller, never env-derived.
 */
export function refuseProduction(env: Record<string, string | undefined>, suite: string): void {
  const names = productionVariables(env);
  if (names.length === 0) return;
  const shown = names.filter((n) => PRINTABLE_NAME.test(n));
  const hidden = names.length - shown.length;
  const list = [...shown, ...(hidden > 0 ? [`${hidden} variable(s) whose name is not shown`] : [])].join(", ");
  throw new Error(
    `${suite} refuses to run against production: ${list} point(s) at production's Supabase project ` +
      `(${PRODUCTION_SUPABASE_REF}). Nothing was written. ${REFUSAL_FIX}`,
  );
}
