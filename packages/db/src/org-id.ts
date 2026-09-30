/**
 * The org-id prefix that marks a THROWAWAY tenant, and the one predicate that
 * recognises it.
 *
 * What it means: an account whose `clerk_org_id` starts with `org_test_` was
 * invented by this repo for a test run and belongs to nobody. Two very
 * different pieces of code depend on that meaning, in opposite directions:
 *
 *   - the fixture sweep (`src/test/sweep-fixtures.ts`) DELETES such an
 *     account once it is an hour old, from the Supabase project that also
 *     serves production;
 *   - `createClientAccount`
 *     (`apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts`) REFUSES
 *     to create one, so nothing a real agency user does can produce a row the
 *     sweep would then delete out from under them.
 *
 * Who mints it: every test fixture in this repo (`packages/db/src/test`,
 * apps/web's own throwaway-account tests) and the demo seeder's throwaway
 * copies, `org_test_demoseed_<random>`. Who must NEVER: production. Clerk
 * mints `org_` plus base58 and never `test_`, so a live organisation fails
 * this predicate by construction — but that was an assumption about an
 * external system until the refusal above made it an enforced one.
 *
 * `demo/seed.ts`'s `SEEDABLE_ORG_ID` regex is the SEEDER's own, stricter gate
 * (`^org_(demo|test)_[a-z0-9_]+$` — it also admits `org_demo_`, and it
 * anchors the whole id): it guards a destructive re-seed, not this sweep, and
 * it is deliberately left alone rather than routed through here.
 *
 * Case-sensitive, and a literal `startsWith` — not a regex and not a
 * normalised compare. The sweep's LIKE query is written against this exact
 * literal, and a predicate that admitted `ORG_TEST_` would admit ids the
 * query never returns.
 */
export const TEST_ORG_ID_PREFIX = "org_test_";

/**
 * Accepts `null`/`undefined` because the callers hold the column, not a
 * validated string: `SweepCandidate.clerk_org_id` is `string | null`. A
 * missing id is not a test id.
 */
export function isTestOrgId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(TEST_ORG_ID_PREFIX);
}
