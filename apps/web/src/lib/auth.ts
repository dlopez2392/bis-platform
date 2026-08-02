import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { serviceDb, getAccountByOrgId } from "@bis/db";

export type AppClaims = { org_id?: string; app_role?: string };

export async function requireAgency(): Promise<{ userId: string }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const claims = sessionClaims as AppClaims;
  if (claims.app_role !== "agency_admin") redirect("/");
  return { userId };
}

/**
 * Allows the agency admin into any account, and a client into exactly one —
 * their own, and only while its client access is on.
 *
 * Uses serviceDb deliberately: this runs BEFORE we trust the caller, so it
 * must be able to see the account row in order to judge it.
 */
export async function requireAccountAccess(
  accountId: string,
): Promise<{ userId: string; isAgency: boolean }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const claims = sessionClaims as AppClaims;

  if (claims.app_role === "agency_admin") return { userId, isAgency: true };

  if (!claims.org_id) redirect("/no-access?reason=none");
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account) redirect("/no-access?reason=none");
  if (!account.client_access_enabled) redirect("/no-access?reason=off");
  // A client asking for someone else's account is sent to their own, not 403'd
  // — a 403 confirms the account exists.
  if (account.id !== accountId) redirect(`/dashboard/accounts/${account.id}/dashboard`);

  return { userId, isAgency: false };
}

/**
 * Guards the two surfaces inside an account that are agency work *about* the
 * client rather than client data: Settings (which will hold the
 * client-access switch itself) and the activation checklist. Navigation
 * hides both from a client, but hiding a link is not authorization — a
 * client who knows the URL still satisfies `requireAccountAccess` for their
 * own account and RLS along with it.
 *
 * Builds on `requireAccountAccess` rather than re-deriving its checks, then
 * additionally rejects a non-agency caller. Redirects to the client's own
 * account dashboard rather than the agency's, and never 403s — same reasoning
 * as `requireAccountAccess`: a 403 would confirm the surface exists for this
 * account rather than simply not being reachable by this caller. By the time
 * `isAgency` is false here, `requireAccountAccess` has already established
 * `accountId` is the caller's own account, so that is exactly where the
 * redirect sends them.
 */
export async function requireAgencyOnlyAccountAccess(
  accountId: string,
): Promise<{ userId: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) redirect(`/dashboard/accounts/${accountId}/dashboard`);
  return { userId };
}

/** The client's own account, or null for the agency admin / an unlinked user. */
export async function resolveClientAccount(): Promise<{ id: string; name: string } | null> {
  const { sessionClaims } = await auth();
  const claims = sessionClaims as AppClaims;
  if (claims?.app_role === "agency_admin" || !claims?.org_id) return null;
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account || !account.client_access_enabled) return null;
  return { id: account.id, name: account.name };
}
