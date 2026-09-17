import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteAccountCascade } from "../account-teardown";
import { DEMO_ACCOUNT_NAME } from "../demo/fiction";

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
 * The two account names a killed run can strand, and the ONLY names this
 * sweep will consider. Each still has to clear the `org_test_` check below —
 * the name narrows the query, the org id prefix is what proves the row is
 * ours.
 *
 * `DEMO_ACCOUNT_NAME` was the gap. demo-seed.test.ts seeds the whole demo
 * tenant under a throwaway `org_test_demoseed_<random>` org and tears it down
 * in a `finally`, so a killed or timed-out run leaves a full Resaca Air
 * account behind — and it is NOT called "Fixture Co", so the sweep walked
 * straight past it. Five of them were sitting in the production project on
 * 2026-09-17, from three CI runs that failed within half an hour, with
 * nothing in the system that would ever have reclaimed them. Imported from
 * the fiction module rather than written out, so renaming the demo tenant
 * cannot silently reopen the gap.
 *
 * The REAL demo tenant is safe by construction: it is `org_demo_resaca_air`,
 * which fails the `org_test_` prefix. That is the whole reason the seeder's
 * org id is injectable, and the reason this sweep keys on the id rather than
 * on the name it shares with its own throwaway copies.
 */
const SWEEPABLE_NAMES: readonly string[] = ["Fixture Co", DEMO_ACCOUNT_NAME];

/**
 * Whether a row is beyond doubt an abandoned fixture.
 *
 * Three conditions, and ALL of them have to hold, because the cost of a false
 * positive here is deleting a real tenant's account from the production
 * database:
 *
 *   - one of the two names a fixture can carry (SWEEPABLE_NAMES), and
 *   - the `org_test_` prefix it generates its clerk org id with — a real
 *     account's id comes from Clerk and never looks like this, so the pair
 *     rules out a genuine business that happens to be called Fixture Co, and
 *   - older than any run that could still be using it.
 *
 * Pure, and exported, so the judgement that decides what gets deleted is
 * tested directly rather than only through a live database.
 */
export function isAbandonedFixture(row: SweepCandidate, now: number): boolean {
  if (!SWEEPABLE_NAMES.includes(row.name)) return false;
  if (!row.clerk_org_id?.startsWith("org_test_")) return false;
  const created = Date.parse(row.created_at);
  if (Number.isNaN(created)) return false;
  return now - created > ABANDONED_AFTER_MS;
}

/**
 * Deletes every abandoned fixture account, and returns what it removed.
 *
 * Filtered in JS rather than in the query on purpose: `isAbandonedFixture` is
 * then the single place the rule lives, and the one place a test has to cover.
 */
export async function sweepAbandonedFixtures(
  db: SupabaseClient, now: number = Date.now(),
): Promise<string[]> {
  const { data, error } = await db.from("accounts")
    .select("id, name, clerk_org_id, created_at")
    // `in`, not `eq` — the demo-seed test's throwaway account carries the
    // demo tenant's name, and an `eq("Fixture Co")` here would filter it out
    // in the QUERY, before isAbandonedFixture ever saw it. The predicate is
    // still the single place the rule lives; this list only has to be no
    // narrower than the predicate.
    .in("name", SWEEPABLE_NAMES);
  // Fail loud rather than silently sweeping nothing — a cleanup that quietly
  // stops working is how the rows accumulated in the first place.
  if (error) throw new Error(`sweepAbandonedFixtures: accounts query failed: ${error.message}`);

  const swept: string[] = [];
  for (const row of (data ?? []) as SweepCandidate[]) {
    if (!isAbandonedFixture(row, now)) continue;
    await deleteAccountCascade(db, row.id, "sweepAbandonedFixtures");
    swept.push(row.id);
  }
  return swept;
}
