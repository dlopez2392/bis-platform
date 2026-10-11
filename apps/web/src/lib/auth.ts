import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { serviceDb, getAccountByOrgId, type AccountRole } from "@bis/db";
import { ensureAccountRole, readStoredRole } from "./team/ensure-role";
import { seesWholeAccount } from "./auth-role";

export { seesWholeAccount };

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
 *
 * Also carries the caller's role (staff and roles, spec §6-§7): `role` is a
 * client's Owner/Staff/Technician role in this account, settled by the per-request
 * fallback (`ensureAccountRole`, which creates a missing membership from
 * Clerk and never throws), and null for the agency or for a client whose
 * role could not be settled. `canManage` is true for the agency and a client
 * Owner only. The stored role is READ beside the account lookup (one
 * round-trip, not two), but nothing is written and Clerk is never asked until
 * the redirects have confirmed this is the caller's own account; a read for
 * an account the caller cannot enter is discarded.
 */
export async function requireAccountAccess(
  accountId: string,
): Promise<{ userId: string; isAgency: boolean; role: AccountRole | null; canManage: boolean }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const claims = sessionClaims as AppClaims;

  // The agency never gets a client membership (plan deviation 6).
  if (claims.app_role === "agency_admin") return { userId, isAgency: true, role: null, canManage: true };

  if (!claims.org_id) redirect("/no-access?reason=none");
  // Started now, beside the account read, so the role costs no round-trip of
  // its own. Keyed on the REQUESTED id and never rejects; if a redirect below
  // fires, it is discarded having written nothing and asked Clerk nothing.
  const storedRole = readStoredRole(accountId, userId);
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account) redirect("/no-access?reason=none");
  if (!account.client_access_enabled) redirect("/no-access?reason=off");
  // A client asking for someone else's account is sent to their own, not 403'd
  // — a 403 confirms the account exists.
  if (account.id !== accountId) redirect(`/dashboard/accounts/${account.id}/dashboard`);

  const role = await ensureAccountRole(account.id, claims.org_id, userId, storedRole);
  return { userId, isAgency: false, role, canManage: role === "owner" };
}

/**
 * Owner-only surfaces inside an account: Billing, calendar settings, contact
 * export and delete, Team. Admits the agency and a client Owner. Staff, a
 * Technician and a client whose role could not be settled (spec §9) are sent
 * to their own home (accountHome), never 403'd, for requireAccountAccess's reason. The database
 * refuses the same writes on its own (0066_staff_and_roles.sql); this is the
 * app's half.
 */
export async function requireAccountOwner(
  accountId: string,
): Promise<{ userId: string; isAgency: boolean }> {
  const { userId, isAgency, canManage, role } = await requireAccountAccess(accountId);
  // accountHome, not the literal dashboard: a Technician refused here would
  // otherwise land on a dashboard that refuses them too (spec §7.1).
  if (!canManage) redirect(accountHome(accountId, role));
  return { userId, isAgency };
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
 * home in the account (accountHome: To do for a Technician, the dashboard
 * otherwise) rather than the agency's, and never 403s — same reasoning
 * as `requireAccountAccess`: a 403 would confirm the surface exists for this
 * account rather than simply not being reachable by this caller. By the time
 * `isAgency` is false here, `requireAccountAccess` has already established
 * `accountId` is the caller's own account, so that is exactly where the
 * redirect sends them.
 */
export async function requireAgencyOnlyAccountAccess(
  accountId: string,
): Promise<{ userId: string }> {
  const { userId, isAgency, role } = await requireAccountAccess(accountId);
  if (!isAgency) redirect(accountHome(accountId, role));
  return { userId };
}

/** Where a person lands inside an account: To do for a Technician (spec §9), the dashboard otherwise. */
export function accountHome(accountId: string, role: AccountRole | null): string {
  return `/dashboard/accounts/${accountId}/${role === "technician" ? "tasks" : "dashboard"}`;
}

/**
 * The surfaces a Technician does not work on (spec §7.1, plan deviation 1):
 * Dashboard, Activity, Pipeline, Website, Forms, Import and Branding, and
 * every action they post. Sends a Technician to their home, never a 403
 * (requireAccountAccess's reason). The database already refuses their reads
 * of other people's customers (0068); this keeps them out of screens whose
 * totals and settings are not theirs.
 *
 * Fails closed, like the database (fix round 1, review M6): it admits only
 * the agency, an Owner and Staff. A client whose role could not be settled
 * (null) is sent where a Technician is, To do, never to the dashboard, which
 * would only refuse them again. To do never calls this guard, so neither
 * redirect can loop (technician-guards.test.ts pins that).
 */
export async function requireNotTechnician(
  accountId: string,
): Promise<{ userId: string; isAgency: boolean; role: AccountRole | null; canManage: boolean }> {
  const access = await requireAccountAccess(accountId);
  // accountHome(…, "technician") is To do: the least-privileged home.
  if (!seesWholeAccount(access)) redirect(accountHome(accountId, "technician"));
  return access;
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
  | { status: "ok"; id: string; name: string; timezone: string; language: string | null }
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
  // `language` added (Spanish-runtime lane, Task 6 fix round 1) — see
  // getAccountByOrgId's own comment: this is the one read the dashboard
  // layout's chrome (AppSidebar/Topbar, rendered ABOVE [accountId]) can
  // resolve a client's locale from, with no second query.
  return { status: "ok", id: account.id, name: account.name, timezone: account.timezone, language: account.language };
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
