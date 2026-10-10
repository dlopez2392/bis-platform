import { cache } from "react";
import {
  readAccountRole, reconcileMembership, serviceDb,
  type AccountRole, type ClerkTeamPort, type SupabaseClient,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { liveClerkTeamPort } from "./clerk-team";

/**
 * The per-request fallback (spec §6): the caller's role in this account,
 * creating their `users` row and membership from Clerk when either is
 * missing, so a dropped webhook never locks anyone out.
 *
 * The common case costs one indexed read and no Clerk call: Clerk is asked
 * only when no membership is stored.
 *
 * Fails closed (spec §9), and never throws: requireAccountAccess runs on
 * every account page and action, and none of those may 500 because the role
 * could not be settled. Any failure, of the stored-role read or of Clerk,
 * yields no role and creates no membership; the person keeps what today's
 * `org_id` policies allow, and every owner-only action and policy refuses
 * them until a later request settles it.
 *
 * `db` is serviceDb(), deliberately: this runs inside requireAccountAccess,
 * BEFORE the caller's role is known (auth.ts's own rule for serviceDb).
 */
export async function ensureAccountRoleWith(
  db: SupabaseClient, port: ClerkTeamPort,
  accountId: string, clerkOrgId: string, clerkUserId: string,
): Promise<AccountRole | null> {
  try {
    const stored = await readAccountRole(db, accountId, clerkUserId);
    if (stored) return stored;
    const r = await reconcileMembership(db, port, { clerkUserId, clerkOrgId, mode: "fallback" });
    return r.outcome === "created" || r.outcome === "exists" ? r.role : null;
  } catch (e) {
    console.error(`ensureAccountRole: could not settle the role for account ${accountId}: ${loggableError(e)}`);
    return null;
  }
}

/** React cache()d per request, so a layout and its page settle the role once. */
export const ensureAccountRole = cache((accountId: string, clerkOrgId: string, clerkUserId: string) =>
  ensureAccountRoleWith(serviceDb(), liveClerkTeamPort(), accountId, clerkOrgId, clerkUserId));
