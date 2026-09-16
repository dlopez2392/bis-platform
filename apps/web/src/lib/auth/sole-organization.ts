/**
 * Which organization to make active for a signed-in user who has none.
 *
 * Clerk keeps the active organization on the SESSION, not on the user. A
 * member of an organization whose session has no active one gets a token with
 * no `org_id` claim — and every guard in lib/auth.ts reads `claims.org_id`, so
 * that user is indistinguishable from someone who belongs to nothing.
 *
 * With `force_organization_selection` off, nothing sets it. Clerk's
 * <OrganizationSwitcher/> would, but the topbar renders that for the agency
 * only (topbar.tsx), so a client had no way to reach it at all: they accepted
 * a valid invitation, signed in, and were told they had no company. That is
 * what happened to 956 Woodworks on 2026-09-16.
 *
 * The e2e client fixture has always called `setActive` by hand to get past
 * this (e2e/auth.setup.ts), with a comment explaining exactly why. The suite
 * therefore passed while the product was broken — the workaround was in the
 * test rather than in the app.
 */

/** One membership, reduced to the only field this decision needs. */
export interface Membership {
  organizationId: string;
}

/**
 * The organization to activate, or `null` to leave the session alone.
 *
 * Exactly one membership, and no active organization already. Each condition
 * is doing work:
 *
 *   - **Zero** memberships is a genuinely unlinked user. There is nothing to
 *     activate and the no-access screen is the correct answer.
 *   - **More than one** is ambiguous, and picking for someone is worse than
 *     asking. It is also the agency's own shape: `createClientAccount` passes
 *     `createdBy`, so the agency admin is a member of every client
 *     organization it creates. This returning null for them is not an
 *     accident — it is the reason this can be mounted app-wide without
 *     quietly moving the agency into a client's organization.
 *   - **An active organization already** means there is nothing to fix, and
 *     re-activating it would fight whatever set it.
 */
export function soleOrganizationToActivate(input: {
  signedIn: boolean;
  activeOrgId: string | null | undefined;
  memberships: readonly Membership[];
}): string | null {
  if (!input.signedIn) return null;
  if (input.activeOrgId) return null;
  if (input.memberships.length !== 1) return null;
  return input.memberships[0]!.organizationId;
}
