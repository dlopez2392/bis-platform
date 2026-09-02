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

/**
 * Like resolveClientAccount below, but distinguishes *why* a non-agency
 * caller has no account to land in: "off" (a real account exists for this
 * org, but its client-access switch is off) vs "none" (no account is
 * linked to this org at all). A caller that only needs "do I have
 * somewhere to send this person" can use resolveClientAccount's collapsed
 * null; a caller that needs to route "off" to the explicit
 * /no-access?reason=off page (design spec section 8 — flipping access off
 * mid-session must show that page, not fall through to a generic message)
 * needs this instead.
 */
export async function resolveClientAccessState(): Promise<
  | { status: "agency" }
  | { status: "ok"; id: string; name: string; timezone: string }
  | { status: "off" }
  | { status: "none" }
> {
  const { sessionClaims } = await auth();
  const claims = sessionClaims as AppClaims;
  if (claims?.app_role === "agency_admin") return { status: "agency" };
  if (!claims?.org_id) return { status: "none" };
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account) return { status: "none" };
  if (!account.client_access_enabled) return { status: "off" };
  return { status: "ok", id: account.id, name: account.name, timezone: account.timezone };
}

/** The client's own account, or null for the agency admin / an unlinked user. */
export async function resolveClientAccount(): Promise<{ id: string; name: string } | null> {
  const state = await resolveClientAccessState();
  return state.status === "ok" ? { id: state.id, name: state.name } : null;
}

/**
 * requireAccountAccess for API route handlers: same checks, but returns
 * null instead of redirecting — the caller answers 404 (never 403/401
 * with substance: don't confirm to a wrong-tenant caller that the
 * resource exists). Client callers get access to exactly their own
 * account, like the page variant.
 */
export async function apiAccountAccess(
  accountId: string,
): Promise<{ userId: string; isAgency: boolean } | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  const claims = sessionClaims as AppClaims;
  if (claims.app_role === "agency_admin") return { userId, isAgency: true };
  if (!claims.org_id) return null;
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account || !account.client_access_enabled) return null;
  if (account.id !== accountId) return null;
  return { userId, isAgency: false };
}
