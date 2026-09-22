import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteAccountCascade } from "../account-teardown";

/**
 * `withTestAccount` deletes its account in a `finally`, which covers a failing
 * assertion but NOT the process being killed underneath it. A killed run
 * leaves a real account row in the Supabase project that also serves
 * production, and it stays there.
 *
 * That is not hypothetical. Merging two PRs 37 seconds apart on 2026-09-15 let
 * the second merge cancel main's CI for the first (`verify` runs with
 * `cancel-in-progress: true`), the job was killed mid-suite, and three
 * `Fixture Co` accounts were left behind — found two hours later only because
 * someone went looking at the accounts table for an unrelated reason.
 *
 * So cleanup cannot rely solely on the happy path unwinding. This sweeps what
 * previous runs abandoned, before the suite starts.
 */

/**
 * Nothing live can be this old. `verify` gives up at 35 minutes
 * (.github/workflows/ci.yml) and this suite's own per-test ceiling is 60
 * seconds, so an hour is comfortably past any run that is still going — while
 * still clearing the table long before the next day's work.
 */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** The shape the sweep needs; `accounts` has more columns than this. */
export interface SweepCandidate {
  id: string;
  name: string;
  clerk_org_id: string | null;
  created_at: string;
}

/**
 * Whether a row is beyond doubt an abandoned fixture.
 *
 * TWO conditions, and both have to hold, because the cost of a false positive
 * here is deleting a real tenant's account from the production database:
 *
 *   - the `org_test_` prefix that every test in this repo generates its clerk
 *     org id with, and
 *   - older than any run that could still be using it.
 *
 * The name is NOT one of them, and that is the point of this rewrite.
 *
 * ── Why the name list had to go ────────────────────────────────────────────
 * This predicate used to carry a third condition: the row's name had to be in
 * a two-entry `SWEEPABLE_NAMES` list. That list was the gap TWICE, in the
 * same week, for the same structural reason — the list lived here while the
 * names were invented somewhere else, sometimes in another package entirely,
 * by someone with no reason to know this file exists.
 *
 *   2026-09-17 — the demo tenant. demo-seed.test.ts seeds the whole Resaca
 *   Air account under a throwaway org, and the account is NOT called
 *   "Fixture Co", so the sweep walked straight past it. Five of them were
 *   sitting in the production project, from three CI runs that failed inside
 *   half an hour. The fix then was to add `DEMO_ACCOUNT_NAME` to the list.
 *
 *   2026-09-20 → 22 — `Fixture Co (call proposals)`. The call-proposals suite
 *   in apps/web rolls its own throwaway account, one name over from the
 *   harness's. `org_test_3gbbpohe` was created on 2026-09-20 16:28 and was
 *   still there two days later, walked past by every sweep in between. The
 *   returning-lead test's own comment records ELEVEN of its accounts piling
 *   up once, for the same reason.
 *
 * Adding a third name would have fixed neither the fourth nor the seven that
 * a `createAccount(` grep on 2026-09-22 actually found. So the list is gone
 * and the rule is the org-id prefix alone.
 *
 * ── Why the prefix alone is safe ───────────────────────────────────────────
 * ASSUMPTION, not a repo-verified invariant: a Clerk-issued org id is `org_`
 * plus an alphanumeric suffix and therefore cannot contain `test_`. Nothing
 * in this repo validates the shape of a Clerk org id — `createAccount` passes
 * Clerk's `org.id` straight through — so this is reasoning about Clerk's
 * format, not an enforced constraint. The live check that backs it today:
 * on 2026-09-22 the project held 6 accounts, of which exactly two matched
 * `clerk_org_id like 'org_test_%'` and both were stranded fixtures (none had
 * a null org id, and none carried `test` anywhere else in the id).
 *
 * Everything that must survive fails the prefix by construction:
 *   - The REAL demo tenant is `org_demo_resaca_air` — which is exactly why
 *     the seeder's org id is injectable, and why this sweep keys on the id
 *     rather than on the name it shares with its own throwaway copies.
 *   - The e2e per-run fixture, "E2E Client Co <stamp>", survives the same
 *     way for a different reason: it is created through a REAL Clerk
 *     organization (`apps/web/e2e/auth.setup.ts:151-158` —
 *     `clerk_.organizations.createOrganization({ name: companyName,
 *     createdBy: user.id })`, then `createAccount(db, { clerkOrgId: org.id,
 *     … })`), so its `clerk_org_id` is whatever Clerk minted, not an
 *     `org_test_`-prefixed id this repo invented. It fails the prefix even
 *     if an e2e run outlives an hour — this sweep was never the mechanism
 *     that could reclaim it, by construction, not by age.
 *   - Every real business gets its id from Clerk.
 * And everything that must be reclaimed carries it, including the cases the
 * name list kept missing: the demo seeder's throwaway copies are
 * `org_test_demoseed_<random>`, so dropping `DEMO_ACCOUNT_NAME` from here
 * loses nothing — the prefix still covers them.
 *
 * Pure, and exported, so the judgement that decides what gets deleted is
 * tested directly rather than only through a live database.
 */
export function isAbandonedFixture(row: SweepCandidate, now: number): boolean {
  if (!row.clerk_org_id?.startsWith("org_test_")) return false;
  const created = Date.parse(row.created_at);
  if (Number.isNaN(created)) return false;
  return now - created > ABANDONED_AFTER_MS;
}

/**
 * Deletes every abandoned fixture account, and returns what it removed.
 *
 * Returns the name alongside the id so the one line this prints into a CI log
 * is readable by a human: an id alone says a row went away, `name (id)` says
 * WHICH suite is being killed mid-run, which is the thing actually worth
 * knowing when the sweep speaks up.
 *
 * Age is still filtered in JS rather than in the query on purpose:
 * `isAbandonedFixture` is then the single place the rule lives, and the one
 * place a test has to cover.
 */
export async function sweepAbandonedFixtures(
  db: SupabaseClient, now: number = Date.now(),
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.from("accounts")
    .select("id, name, clerk_org_id, created_at")
    // No name filter, and there must never be one again — a name filter here
    // would reintroduce the exact gap the predicate above just closed, in the
    // one place a test of the predicate cannot see. This narrows on the org
    // id only, which is the predicate's own first condition, so the query
    // stays no narrower than the predicate.
    .like("clerk_org_id", "org_test_%");
  // Fail loud rather than silently sweeping nothing — a cleanup that quietly
  // stops working is how the rows accumulated in the first place.
  if (error) throw new Error(`sweepAbandonedFixtures: accounts query failed: ${error.message}`);

  // No per-row try/catch: one undeletable stray (an FK this cascade doesn't
  // know about, a permissions blip) throws out of the loop and blocks every
  // account after it in this batch, which — since this runs in globalSetup —
  // blocks the whole db suite. Deliberately fail-closed rather than
  // swallowing the error and moving on: a delete path that quietly skips a
  // row is exactly the mechanism that let these rows accumulate in the first
  // place (see the doc block above). The trade-off is a wider blast radius
  // than the old name-list rule ever had, for a stray this sweep cannot
  // clear itself either way.
  const swept: { id: string; name: string }[] = [];
  for (const row of (data ?? []) as SweepCandidate[]) {
    if (!isAbandonedFixture(row, now)) continue;
    await deleteAccountCascade(db, row.id, "sweepAbandonedFixtures");
    swept.push({ id: row.id, name: row.name });
  }
  return swept;
}
