/**
 * Finding the SEEDED account (`SEEDED_ACCOUNT_NAME` in ../support.ts) at run
 * time, and failing loudly when it is not there.
 *
 * WHY THIS IS A FAILURE, NOT A SKIP. The seeded account is the "someone else"
 * in several boundary checks and the real data in several read-only specs.
 * Until 2026-09-24 a missing account either SKIPPED (`openAccountByName`) or
 * was never looked for at all (`client-branding.spec.ts` carried a production
 * row id as a literal). On a project where that account does not exist — a
 * fresh or reset one, or the separate CI project before `ci:seed` has run —
 * the first shape turns specs into skips and the second turns "another
 * company's row stays untouched" into a check against a row that was never
 * there. Both read as green. So a missing seed is an operator error with one
 * fix, and this module says which.
 *
 * Kept free of Playwright so its decisions are unit-tested (./seeded.test.ts).
 */
import type { serviceDb } from "@bis/db";

/** The command that creates the seeded baseline on a project that lacks it. */
export const CI_SEED_COMMAND = "pnpm --filter @bis/db ci:seed";

/** The one message every caller fails with when the account is absent. */
export function seededAccountMissingMessage(name: string, where: string): string {
  return (
    `No account named "${name}" found ${where}. The e2e suite reads this seeded ` +
    `account and fails without it rather than skipping; on a fresh or CI Supabase ` +
    `project run \`${CI_SEED_COMMAND}\` first.`
  );
}

type Db = ReturnType<typeof serviceDb>;

/**
 * The seeded account's id, looked up by exact name with the service role.
 *
 * Throws — never returns a fallback — when the query faults, when no account
 * has that name, or when more than one does: a boundary check aimed at an
 * ambiguous "other company" would be asserting against whichever row happened
 * to come back first.
 */
export async function lookupSeededAccountId(db: Db, name: string): Promise<string> {
  const { data, error } = await db.from("accounts").select("id").eq("name", name).limit(2);
  if (error) throw new Error(`seeded account lookup for "${name}" failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(seededAccountMissingMessage(name, "in the accounts table"));
  }
  if (rows.length > 1) {
    throw new Error(
      `More than one account is named "${name}"; the seeded account must be unique ` +
      `for a spec to address it by name.`,
    );
  }
  return rows[0]!.id;
}

/**
 * Puts the seeded account's `brand_color` back to `before` IF, and only if, it
 * no longer holds it. Returns whether it wrote.
 *
 * client-branding.spec.ts used to call `setBranding` on the seeded account in
 * an unconditional `finally`. The colour it wrote was the one it had just
 * read, so the column never changed — but `setBranding` also emits
 * `account.branding_updated`, so EVERY run appended an audit event to a real
 * account (`Test Client One` in production), attributed to that run's
 * throwaway Clerk user. On a green run the right number of writes to someone
 * else's account is zero.
 *
 * When the negative case has failed — the client's PATCH got through — the
 * only column that PATCH carried is `brand_color` (and `accounts` has no
 * update trigger), so writing that one column back restores exactly what was
 * found. It is written directly rather than through `setBranding`, so the
 * restore adds no event of its own; and `.select("id")` makes a restore that
 * matched nothing an error instead of a silent success.
 */
export async function restoreSeededBrandColor(
  db: Db, accountId: string, before: string | null,
): Promise<boolean> {
  const { data: now, error: readError } = await db.from("accounts")
    .select("brand_color").eq("id", accountId).maybeSingle();
  if (readError) throw new Error(`reading ${accountId}'s brand_color failed: ${readError.message}`);
  if (!now) throw new Error(`restore: no account ${accountId}`);
  if ((now as { brand_color: string | null }).brand_color === before) return false;

  const { data, error } = await db.from("accounts")
    .update({ brand_color: before }).eq("id", accountId).select("id");
  if (error) throw new Error(`restoring ${accountId}'s brand_color failed: ${error.message}`);
  if (!data?.length) throw new Error(`restore: no account ${accountId}`);
  return true;
}
