/**
 * What `ci:seed` puts in the CI project, and the guard in front of it.
 *
 * The e2e suite reads ONE hand-made account, "Test Client One", that no script
 * ever created: it was built by hand in the M1a smoke
 * (docs/superpowers/plans/2026-07-26-m1a-crm-core.md, Task 9 Step 5), and
 * `openAccountByName` SKIPS when it is missing — so a fresh CI project would
 * turn contacts/pipeline/palette specs into a vacuous green. This file names
 * what that account has to hold, so a script can make it (./seed.ts) and say
 * when it is not there. Every value is pinned by ./config.test.ts against the
 * spec, migration or rule that depends on it.
 */
import { assertCiTarget, describeCiTarget, type CiTarget } from "../ci/target";

/** Every write is attributed to this in `events`. Not a Clerk user id. */
export const CI_SEED_ACTOR = "system_ci_seed";

/**
 * The injectable part. `ci:seed` always uses CI_BASELINE; the idempotence
 * test (./seed.integration.test.ts) uses a throwaway name, an `org_test_`
 * org the fixture sweep can reclaim, and a `+999` number, so it never touches
 * the real seeded account — the same reason the demo seeder's org id is
 * injectable (test/sweep-fixtures.ts).
 */
export type CiBaselineSpec = { name: string; clerkOrgId: string; phoneE164: string };

export const CI_BASELINE: CiBaselineSpec = {
  /** apps/web/e2e/support.ts SEEDED_ACCOUNT_NAME. */
  name: "Test Client One",
  /**
   * The Clerk DEVELOPMENT instance's "Test Client One" organization
   * (docs/runbooks/clerk-setup.md, Findings table, read 2026-09-14) — the org
   * the agency user clicks in auth.setup.ts. The agency path never reads it;
   * a real id keeps the accounts page's orphan-org banner quiet. It must not
   * start with `org_test_`, or the db suite's fixture sweep deletes the
   * account an hour after it is seeded.
   */
  clerkOrgId: "org_3H2aweJ6b2GRZghk3DCrNDmrMXU",
  /**
   * numbers.spec.ts needs at least one number on an account that is NOT the
   * per-run fixture. 555-0100..0199 is the NANP block reserved for fiction,
   * in area code 210, so it stays out of the demo tenant's +1 956 555 01xx
   * partition (demo/fiction.ts). No telnyx_id: nothing routes to it.
   */
  phoneE164: "+12105550100",
};

/** apps/web/e2e/support.ts SEEDED_CONTACT_NAME, with the M1a smoke's address. */
export const CI_SEED_CONTACT = { firstName: "Maria", lastName: "Garcia", email: "maria@example.com" };

/** pipeline.spec.ts drags a card; the M1a smoke's "Deck build, $4500". */
export const CI_SEED_OPPORTUNITY = { name: "Deck build", value: 4500 };

/** blueprints.spec.ts captures this field from Test Client One and expects it back. */
export const CI_SEED_FIELD = {
  fieldKey: "referral_source", name: "Referral Source", options: ["google", "friend"],
} as const;

/** ensureDefaultPipeline's name (crm-config.ts); pipeline.spec and blueprints.spec read it. */
export const CI_SEED_PIPELINE = "Sales";

/** Public; branding.ts uploads to it and demo-seed.test.ts does so live. */
export const CI_SEED_BUCKET = "brand-logos";

export function planCiSeed(env: Record<string, string | undefined>): {
  target: CiTarget; spec: CiBaselineSpec; summary: string;
} {
  const target = assertCiTarget({
    ref: env.BIS_CI_SUPABASE_REF,
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    dbUrl: env.SUPABASE_DB_URL,
  });
  const spec = CI_BASELINE;
  const summary = [
    `ci:seed "${spec.name}" (${spec.clerkOrgId})`,
    describeCiTarget(target),
    `  adds only what is missing; never updates or deletes`,
  ].join("\n");
  return { target, spec, summary };
}
