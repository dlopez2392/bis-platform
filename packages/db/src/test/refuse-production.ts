/**
 * The guard in front of every LIVE test run in this package: the db suite
 * (./global-setup.ts) and the integration suite (./refuse-production.setup.ts).
 *
 * Why. CI runs on its own Supabase project behind
 * .github/scripts/ci-target-guard.sh, but a local run reads whatever
 * packages/db/.env holds, and on a machine whose env files have not been
 * switched (docs/runbooks/ci-supabase-project.md, section 9) that is
 * production. The suite creates and deletes accounts and the fixture sweep
 * deletes rows, so a local `pnpm check` there wrote production.
 *
 * Refusing production is all it does. It does NOT require the CI project: a
 * developer may point a run at a project of their own, and the "no
 * credentials, skip the sweep" path still works. The strict allowlist lives in
 * CI's guard and in ../ci/target.ts `assertCiTarget`, which the CI-only tools
 * run.
 *
 * The production ref is ../ci/target.ts's constant, and its detection
 * (`mentionsProduction`: case-insensitive, percent-decoded up to three
 * rounds). apps/web cannot import that file (@bis/db exports only "." and
 * "./search-term", and it imports `pg`), so apps/web/e2e/fixtures/
 * production-guard.ts carries its own copy of the ref, pinned to this one by
 * its test.
 *
 * Messages name VARIABLES, never values: a DB URL carries a password.
 */
import { PRODUCTION_SUPABASE_REF, mentionsProduction } from "../ci/target";

/**
 * A variable whose value can choose the database a test reaches: any name
 * containing SUPABASE (the API URL, the DB URL, BIS_CI_SUPABASE_REF …) or a
 * PG* default that node-pg reads when the URL leaves a field unset. Names are
 * matched case-insensitively: Windows environment names are.
 */
function canPickTheDatabase(name: string): boolean {
  return /supabase/i.test(name) || /^pg/i.test(name);
}

/** A name safe to print. Anything else is counted, not shown. */
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
 * `suite` is a literal from the caller ("The db suite"), never env-derived.
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
