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
 * Three conditions, and ALL of them have to hold, because the cost of a false
 * positive here is deleting a real tenant's account from the production
 * database:
 *
 *   - the name `withTestAccount` hard-codes, and
 *   - the `org_test_` prefix it generates its clerk org id with — a real
 *     account's id comes from Clerk and never looks like this, so the pair
 *     rules out a genuine business that happens to be called Fixture Co, and
 *   - older than any run that could still be using it.
 *
 * Pure, and exported, so the judgement that decides what gets deleted is
 * tested directly rather than only through a live database.
 */
export function isAbandonedFixture(row: SweepCandidate, now: number): boolean {
  if (row.name !== "Fixture Co") return false;
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
    .eq("name", "Fixture Co");
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
