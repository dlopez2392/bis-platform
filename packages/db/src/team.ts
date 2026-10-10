import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Staff and roles (spec §5-§7). BIS owns the role; Clerk owns org membership.
 *
 * `setAccountMemberRole`/`removeAccountMember` call `0066_staff_and_roles.sql`'s
 * two service_role-only RPCs (`team-functions.test.ts` pins that grant), so a
 * `db` passed to them must be `serviceDb()`, never `userDb()`.
 */

export type AccountRole = "owner" | "staff";
export type PersonLanguage = "en" | "es";
export type TeamMember = {
  userId: string; clerkUserId: string; email: string; name: string | null;
  role: AccountRole; language: PersonLanguage | null;
};

const ROLES: readonly string[] = ["owner", "staff"];
const LANGS: readonly string[] = ["en", "es"];

const field = (meta: unknown, k: string): unknown =>
  typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>)[k] : undefined;

/** The rule from spec §6, failing safe (corrected 2026-10-10 after review,
 *  I4): the Clerk role gives one answer (org:admin -> owner, else staff), and
 *  each valid `bis_role` in the membership's metadata (Clerk copies an
 *  invitation's public metadata onto it) or the accepted invitation's own
 *  metadata gives another. Owner only when EVERY answer says owner; any
 *  disagreement is the less privileged, staff. Metadata a role change left
 *  stale can therefore only ever demote, never mint an Owner. */
export function roleFromClerk(input: { clerkRole: string; membershipMeta?: unknown; invitationMeta?: unknown }): AccountRole {
  const answers: AccountRole[] = [input.clerkRole === "org:admin" ? "owner" : "staff"];
  for (const meta of [input.membershipMeta, input.invitationMeta]) {
    const r = field(meta, "bis_role");
    if (typeof r === "string" && ROLES.includes(r)) answers.push(r as AccountRole);
  }
  return answers.every((a) => a === "owner") ? "owner" : "staff";
}

/** The event type the Team's removal writes (actor_type 'system'); see apps/web lib/team/removal-log.ts. */
export const MEMBER_REMOVED_EVENT = "team.member_removed";

/**
 * Whether a system-written removal of this Clerk user from this account is
 * NEWER than the Clerk membership being settled (review I3). If so, the
 * membership is the one the removal was deleting, still visible because
 * Clerk's delete had not landed when it was read, and must not be recreated.
 * An undo or a fresh invitation makes a NEW membership, created after the
 * removal, which passes. A failed read throws: "could not tell" must never
 * read as "not removed".
 */
async function removedSince(db: SupabaseClient, accountId: string, clerkUserId: string, membershipCreatedAt: number): Promise<boolean> {
  const { data, error } = await db.from("events").select("id")
    .eq("account_id", accountId).eq("type", MEMBER_REMOVED_EVENT).eq("actor_type", "system")
    .eq("payload->>clerkUserId", clerkUserId).gt("created_at", new Date(membershipCreatedAt).toISOString())
    .limit(1).maybeSingle();
  if (error) throw new Error(`reconcileMembership removal lookup failed: ${error.message}`);
  return data !== null;
}

/** The first valid en|es across every metadata object given, in order. */
export function languageFromClerk(...metas: unknown[]): PersonLanguage | null {
  for (const meta of metas) {
    const l = field(meta, "bis_language");
    if (typeof l === "string" && LANGS.includes(l)) return l as PersonLanguage;
  }
  return null;
}

/** `public_metadata.app_role === "agency_admin"` — agency users are never synced into client teams. */
export const isAgencyMetadata = (publicMetadata: unknown): boolean => field(publicMetadata, "app_role") === "agency_admin";

export async function readAccountRole(db: SupabaseClient, accountId: string, clerkUserId: string): Promise<AccountRole | null> {
  const { data, error } = await db.from("memberships").select("role, users!inner(clerk_user_id)")
    .eq("scope", "account").eq("account_id", accountId).eq("users.clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readAccountRole failed: ${error.message}`);
  return (data?.role as AccountRole | undefined) ?? null;
}

/**
 * Email and name follow Clerk on every call. `language` is only ever SET
 * here when the row has none (an invitation's or the first webhook's
 * choice) — never overwritten, because a person's own later choice (F-096)
 * must survive a replayed Clerk event.
 */
export async function upsertUserFromClerk(
  db: SupabaseClient,
  u: { clerkUserId: string; email: string; name: string | null; language?: PersonLanguage | null },
): Promise<string> {
  const { data, error } = await db.from("users")
    .upsert({ clerk_user_id: u.clerkUserId, email: u.email, name: u.name }, { onConflict: "clerk_user_id" })
    .select("id, language").single();
  if (error) throw new Error(`upsertUserFromClerk failed: ${error.message}`);
  if (u.language && data.language === null) {
    const { error: e2 } = await db.from("users").update({ language: u.language }).eq("id", data.id).is("language", null);
    if (e2) throw new Error(`upsertUserFromClerk language failed: ${e2.message}`);
  }
  return data.id as string;
}

export async function addAccountMember(
  db: SupabaseClient, m: { accountId: string; userId: string; role: AccountRole },
): Promise<"created" | "existed"> {
  const { data, error } = await db.from("memberships")
    .upsert({ scope: "account", account_id: m.accountId, user_id: m.userId, role: m.role },
            { onConflict: "account_id,user_id", ignoreDuplicates: true })
    .select("id");
  // 23505: 0001's expression index `memberships_unique` (user_id, scope,
  // coalesce(agency_id), coalesce(account_id)) still sits beside 0066's
  // `memberships_account_user_key`. ON CONFLICT only absorbs a conflict on its
  // arbiter, so two requests racing to insert the same row can lose on the
  // OLDER index instead and raise 23505. Either way the row exists.
  if (error && (error as { code?: unknown }).code === "23505") return "existed";
  if (error) throw new Error(`addAccountMember failed: ${error.message}`);
  return (data ?? []).length > 0 ? "created" : "existed";
}

/** The webhook's "Clerk says gone" path: no last-Owner guard. Server-only (0066 §5: no delete grant to authenticated). */
export async function deleteAccountMembership(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { error } = await db.from("memberships").delete().eq("scope", "account").eq("account_id", accountId).eq("user_id", userId);
  if (error) throw new Error(`deleteAccountMembership failed: ${error.message}`);
}

export async function setAccountMemberRole(
  db: SupabaseClient, accountId: string, userId: string, role: AccountRole,
): Promise<"ok" | "last_owner" | "not_found"> {
  const { data, error } = await db.rpc("set_account_member_role", { p_account_id: accountId, p_user_id: userId, p_role: role });
  if (error) throw new Error(`setAccountMemberRole failed: ${error.message}`);
  return data as "ok" | "last_owner" | "not_found";
}

export async function removeAccountMember(
  db: SupabaseClient, accountId: string, userId: string,
): Promise<"ok" | "last_owner" | "not_found"> {
  const { data, error } = await db.rpc("remove_account_member", { p_account_id: accountId, p_user_id: userId });
  if (error) throw new Error(`removeAccountMember failed: ${error.message}`);
  return data as "ok" | "last_owner" | "not_found";
}

export async function setMemberLanguage(
  db: SupabaseClient, accountId: string, userId: string, language: PersonLanguage | null,
): Promise<"ok" | "not_found"> {
  const { data: existing, error: selErr } = await db.from("memberships").select("id")
    .eq("scope", "account").eq("account_id", accountId).eq("user_id", userId).maybeSingle();
  if (selErr) throw new Error(`setMemberLanguage lookup failed: ${selErr.message}`);
  if (!existing) return "not_found";
  const { error } = await db.from("users").update({ language }).eq("id", userId);
  if (error) throw new Error(`setMemberLanguage failed: ${error.message}`);
  return "ok";
}

export async function listAccountTeam(db: SupabaseClient, accountId: string): Promise<TeamMember[]> {
  const { data, error } = await db.from("memberships")
    .select("role, users!inner(id, clerk_user_id, email, name, language)")
    .eq("scope", "account").eq("account_id", accountId)
    .order("email", { referencedTable: "users" });
  if (error) throw new Error(`listAccountTeam failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const u = row.users as unknown as { id: string; clerk_user_id: string; email: string; name: string | null; language: string | null };
    return {
      userId: u.id, clerkUserId: u.clerk_user_id, email: u.email, name: u.name,
      role: row.role as AccountRole, language: (u.language as PersonLanguage | null) ?? null,
    };
  });
}

/**
 * How long before a membership's creation its invitation may have been
 * accepted and still count as THAT membership's invitation. Clerk stamps the
 * acceptance (the invitation's `updatedAt`) and the membership's `createdAt`
 * in the same flow, but not in one transaction, so allow for skew. Observed
 * on the Clerk development instance (2026-10-10): updated_at = membership
 * created_at + 19 ms. 60 s is ample for that, and narrow enough that an
 * invitation accepted for an EARLIER membership cannot fall inside it.
 */
export const INVITE_ACCEPT_ALLOWANCE_MS = 60 * 1000;

/** What reconcile needs from Clerk. The web app supplies a clerkClient adapter; tests supply a fake. */
export interface ClerkTeamPort {
  getUser(clerkUserId: string): Promise<{ email: string | null; name: string | null; publicMetadata: unknown } | null>;
  /** `createdAt` is Clerk's epoch-ms stamp, which binds an accepted invitation to this membership. */
  getMembership(clerkUserId: string, clerkOrgId: string): Promise<{ role: string; publicMetadata: unknown; createdAt: number } | null>;
  /**
   * The public metadata of the most recently accepted invitation for `email`
   * whose acceptance is at or after `acceptedSince` (epoch ms), else null.
   * Without that bound an OLD invitation (Owner, accepted years ago, the
   * person since removed and re-added directly as a member) would re-grant
   * its role to a membership it was never for.
   */
  acceptedInvitationMeta(clerkOrgId: string, email: string, acceptedSince: number): Promise<unknown | null>;
}

export type ReconcileOutcome =
  | { outcome: "no_account" } | { outcome: "agency_user" } | { outcome: "no_email" }
  | { outcome: "created" | "exists"; role: AccountRole } | { outcome: "removed" | "absent" | "stale" };

/**
 * Makes BIS match Clerk's CURRENT state for (user, org): re-reads, never
 * trusts an event payload, so a replayed `created` that arrives after a
 * `deleted` converges to "absent"/"removed" instead of resurrecting the row.
 * Agency users (`isAgencyMetadata`) are never synced into a client team
 * (plan deviation 6) — the agency admin who created a client org via
 * `createClientAccount` is an `org:admin` member of it, and under the
 * fallback rule would otherwise become its Owner.
 */
export async function reconcileMembership(
  db: SupabaseClient, clerk: ClerkTeamPort,
  input: { clerkUserId: string; clerkOrgId: string; mode: "webhook" | "fallback" },
): Promise<ReconcileOutcome> {
  const { data: account, error } = await db.from("accounts").select("id").eq("clerk_org_id", input.clerkOrgId).maybeSingle();
  if (error) throw new Error(`reconcileMembership account lookup failed: ${error.message}`);
  if (!account) return { outcome: "no_account" };

  const membership = await clerk.getMembership(input.clerkUserId, input.clerkOrgId);
  if (!membership) {
    if (input.mode === "fallback") return { outcome: "absent" }; // the fallback never removes anyone
    const { data: u, error: lookupErr } = await db.from("users").select("id").eq("clerk_user_id", input.clerkUserId).maybeSingle();
    if (lookupErr) throw new Error(`reconcileMembership user lookup failed: ${lookupErr.message}`);
    if (u) await deleteAccountMembership(db, account.id, u.id);
    return { outcome: "removed" };
  }

  const user = await clerk.getUser(input.clerkUserId);
  if (user && isAgencyMetadata(user.publicMetadata)) return { outcome: "agency_user" };
  if (!user?.email) return { outcome: "no_email" };

  const existing = await readAccountRole(db, account.id, input.clerkUserId);
  if (existing) return { outcome: "exists", role: existing };

  // A removal newer than this membership means the Team is deleting it (I3).
  if (await removedSince(db, account.id, input.clerkUserId, membership.createdAt)) return { outcome: "stale" };

  const invitationMeta = await clerk.acceptedInvitationMeta(
    input.clerkOrgId, user.email, membership.createdAt - INVITE_ACCEPT_ALLOWANCE_MS);
  const role = roleFromClerk({ clerkRole: membership.role, membershipMeta: membership.publicMetadata, invitationMeta });
  const userId = await upsertUserFromClerk(db, {
    clerkUserId: input.clerkUserId, email: user.email, name: user.name,
    language: languageFromClerk(membership.publicMetadata, invitationMeta),
  });
  const r = await addAccountMember(db, { accountId: account.id, userId, role });
  return r === "created"
    ? { outcome: "created", role }
    : { outcome: "exists", role: (await readAccountRole(db, account.id, input.clerkUserId)) ?? role };
}
