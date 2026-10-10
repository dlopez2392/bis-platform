import { cache } from "react";
import {
  readAccountRole, reconcileMembership, serviceDb,
  type AccountRole, type ClerkTeamPort, type SupabaseClient,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { liveClerkTeamPort } from "./clerk-team";
import { withTimeout } from "./with-timeout";

/**
 * The per-request fallback (spec §6): the caller's role in this account,
 * creating their `users` row and membership from Clerk when either is
 * missing, so a dropped webhook never locks anyone out.
 *
 * The common case costs one indexed read and no Clerk call, and that read is
 * started by requireAccountAccess BESIDE its own account read
 * (`readStoredRole`), so it adds no round-trip of its own. Clerk is asked only
 * when no membership is stored.
 *
 * Fails closed (spec §9), and never throws: requireAccountAccess runs on
 * every account page and action, and none of those may 500 because the role
 * could not be settled. Any failure (the stored-role read, Clerk, or Clerk
 * taking longer than CLERK_FALLBACK_TIMEOUT_MS) yields no role; the person
 * keeps what today's `org_id` policies allow, and every owner-only action and
 * policy refuses them until a later request settles it.
 *
 * serviceDb(), deliberately: this runs inside requireAccountAccess, BEFORE
 * the caller's role is known (auth.ts's own rule for serviceDb).
 */

/** What the stored-role read resolves to when it failed. It never rejects. */
export const STORED_READ_FAILED = Symbol("stored role read failed");
export type StoredRole = AccountRole | null | typeof STORED_READ_FAILED;

/**
 * `@clerk/backend` sets no request timeout, and this sits in front of every
 * page. Past this, the request goes on with no role (spec §9). A reconcile
 * that finishes later still writes its row, for the next request to read.
 */
export const CLERK_FALLBACK_TIMEOUT_MS = 3000;

/**
 * The stored role, as a promise that NEVER rejects: its catch is attached
 * here, at creation, because requireAccountAccess starts it before its
 * redirects and may throw a redirect without ever awaiting it. A rejected
 * promise nobody awaits would surface as an unhandled rejection.
 */
export function readStoredRoleWith(db: () => SupabaseClient, accountId: string, clerkUserId: string): Promise<StoredRole> {
  return (async () => readAccountRole(db(), accountId, clerkUserId))().catch((e: unknown) => {
    console.error(`ensureAccountRole: could not read the stored role for account ${accountId}: ${loggableError(e)}`);
    return STORED_READ_FAILED;
  });
}

/** The testable core. `stored`, when given, is a read already in flight (see readStoredRole). */
export async function ensureAccountRoleWith(
  db: SupabaseClient, port: ClerkTeamPort,
  accountId: string, clerkOrgId: string, clerkUserId: string,
  stored?: Promise<StoredRole>,
): Promise<AccountRole | null> {
  const s = await (stored ?? readStoredRoleWith(() => db, accountId, clerkUserId));
  if (s === STORED_READ_FAILED) return null; // already logged
  if (s) return s;
  try {
    const r = await withTimeout(
      reconcileMembership(db, port, { clerkUserId, clerkOrgId, mode: "fallback" }), CLERK_FALLBACK_TIMEOUT_MS);
    return r.outcome === "created" || r.outcome === "exists" ? r.role : null;
  } catch (e) {
    console.error(`ensureAccountRole: could not settle the role for account ${accountId}: ${loggableError(e)}`);
    return null;
  }
}

/**
 * React cache()d per request and keyed on the REQUESTED account id:
 * requireAccountAccess starts it beside getAccountByOrgId, before it knows
 * whether the caller may enter that account. A read for someone else's
 * account is simply discarded by the redirect: it writes nothing and asks
 * Clerk nothing.
 */
export const readStoredRole = cache((accountId: string, clerkUserId: string): Promise<StoredRole> =>
  readStoredRoleWith(serviceDb, accountId, clerkUserId));

/** React cache()d per request, so a layout and its page settle the role once. */
export const ensureAccountRole = cache((accountId: string, clerkOrgId: string, clerkUserId: string, stored?: Promise<StoredRole>) =>
  ensureAccountRoleWith(serviceDb(), liveClerkTeamPort(), accountId, clerkOrgId, clerkUserId,
    stored ?? readStoredRole(accountId, clerkUserId)));
