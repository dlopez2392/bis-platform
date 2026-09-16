/**
 * A Clerk organization with no `accounts` row behind it.
 *
 * The two halves of a company are created together by `createClientAccount`,
 * which deletes the Clerk org if the account insert fails precisely so this
 * cannot happen. It happens anyway when an org is created OUTSIDE that flow —
 * from the Clerk dashboard, most obviously, which is a normal thing for an
 * operator to do and which nothing warns them about.
 *
 * The result is a company that can send invitations and cannot be signed into.
 * `requireAccountAccess` resolves a tenant by `clerk_org_id`, finds nothing,
 * and sends the invited person to /no-access — so the FIRST person to discover
 * it is the client, on their first visit, and the agency learns about it from
 * them. That happened to a real customer on 2026-09-16.
 *
 * Nothing here repairs an orphan. It makes one visible on the screen the
 * agency opens every day, which is the part that was missing.
 */

/** The fields of a Clerk organization this needs; Clerk returns many more. */
export interface ClerkOrgSummary {
  id: string;
  name: string;
  createdAt?: number;
}

/** The fields of an account row this needs. */
export interface AccountOrgLink {
  clerk_org_id: string;
}

/**
 * Clerk orgs with no matching account row, oldest first.
 *
 * Pure and exported so the judgement is tested directly rather than only
 * through a page that needs a live Clerk key and a live database.
 *
 * One direction only. An account row whose Clerk org has been deleted is a
 * different fault with a different remedy, and reporting both here would make
 * this list something an operator has to interpret rather than act on.
 */
export function orphanedOrgs(
  orgs: readonly ClerkOrgSummary[],
  accounts: readonly AccountOrgLink[],
): ClerkOrgSummary[] {
  const linked = new Set(accounts.map((a) => a.clerk_org_id));
  return orgs
    .filter((o) => !linked.has(o.id))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
