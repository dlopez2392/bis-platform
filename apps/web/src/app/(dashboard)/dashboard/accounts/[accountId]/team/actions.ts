"use server";

import { revalidatePath } from "next/cache";
import {
  serviceDb, listAccountTeam, setAccountMemberRole, setMemberLanguage, removeAccountMember, addAccountMember,
  type AccountRole, type PersonLanguage, type SupabaseClient, type TeamMember,
} from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import {
  teamCapacity, createTeamInvitation, revokeTeamInvitation, removeFromOrganization,
  restoreToOrganization, setOrganizationRole,
} from "@/lib/team/clerk-team";
import {
  roomLeft, inviteDefaultLanguage, clerkInviteError,
  isTeamUserId, isInvitationId, isClerkUserId, isAccountRole, isPersonLanguage,
} from "@/lib/team/team-view";
import { isValidEmail } from "@/lib/forms/guards";
import { loggableError } from "@/lib/loggable-error";

/**
 * The Team actions (staff and roles, spec §8).
 *
 * Every action's FIRST statement is `await requireAccountOwner(accountId)`,
 * which admits the agency and a client Owner and redirects everyone else.
 * `accountId` is bound server-side by the page (`.bind(null, accountId)`),
 * never a form field. Team rows are server-only since 0066 (no INSERT,
 * UPDATE or DELETE grant to `authenticated`; the two RPCs are
 * service_role-only), so every write goes through `serviceDb()`, and the
 * guard above is what stands in front of it.
 *
 * Errors are CODES, not copy: the Team card (Task 10) maps each `TeamError`
 * to its sentence in `messages.ts` (`team.*`, with `.es` twins). That keeps
 * this file out of the shared copy catalogue while Tasks 6-8 edit it.
 *
 * The Clerk role FOLLOWS the BIS role (owner -> org:admin, staff ->
 * org:member). The BIS write decides, because it carries the last-Owner
 * guard; Clerk is asked second, and a Clerk failure is retried once, then
 * the BIS change is rolled back, so BIS Staff beside Clerk org:admin (who
 * could invite an Owner through Clerk's browser API) is never the state a
 * failure leaves behind, short of the rollback itself failing too, which is
 * logged by id.
 */

export type TeamError =
  | "team.full" | "team.accessOff" | "team.lastOwner" | "team.changed"
  | "team.invite.badEmail" | "team.invite.alreadyInvited" | "team.invite.alreadyMember" | "team.invite.failed"
  | "team.role.failed" | "team.remove.failed" | "team.undo.failed" | "team.revoke.failed";
export type TeamResult = { ok: true } | { ok: false; error: TeamError };

type Account = { orgId: string; accessOn: boolean; language: unknown };

/** select("*") so the account's language is picked up once the runtime lane adds the column, without naming one that may not exist yet. */
async function readAccount(db: SupabaseClient, accountId: string): Promise<Account> {
  const { data, error } = await db.from("accounts").select("*").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`team: account lookup failed: ${error.message}`);
  if (!data) throw new Error("team: account not found");
  const row = data as Record<string, unknown>;
  return { orgId: String(row.clerk_org_id), accessOn: row.client_access_enabled === true, language: row.language };
}

async function findMember(db: SupabaseClient, accountId: string, userId: string): Promise<TeamMember | null> {
  return (await listAccountTeam(db, accountId)).find((m) => m.userId === userId) ?? null;
}

function revalidateTeam(accountId: string): void {
  revalidatePath(`/dashboard/accounts/${accountId}/team`);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

const INVITE_ERROR: Record<ReturnType<typeof clerkInviteError>, TeamError> = {
  already_invited: "team.invite.alreadyInvited",
  already_member: "team.invite.alreadyMember",
  full: "team.full",
  failed: "team.invite.failed",
};

/** Shared by the invite and the undo of a revoke. Runs only after the caller's own guard. */
async function invite(
  accountId: string, inviterUserId: string,
  i: { email: string; role: AccountRole; language: PersonLanguage | null },
): Promise<TeamResult> {
  const account = await readAccount(serviceDb(), accountId);
  if (!account.accessOn) return { ok: false, error: "team.accessOff" };

  // A known full team is refused before Clerk is asked. An unreadable cap
  // does not block the invite: Clerk enforces its own quota, and its
  // refusal maps to the same team.full.
  let cap: Awaited<ReturnType<typeof teamCapacity>> | null = null;
  try {
    cap = await teamCapacity(account.orgId);
  } catch (e) {
    console.error(`team invite: capacity unreadable for account ${accountId}: ${loggableError(e)}`);
  }
  if (cap && roomLeft(cap) === 0) return { ok: false, error: "team.full" };

  const res = await createTeamInvitation({
    orgId: account.orgId, email: i.email, role: i.role,
    language: i.language ?? inviteDefaultLanguage(account.language), inviterUserId,
  });
  if (!res.ok) return { ok: false, error: INVITE_ERROR[clerkInviteError(res.code ?? undefined)] };
  revalidateTeam(accountId);
  return { ok: true };
}

export async function inviteTeamMemberAction(accountId: string, formData: FormData): Promise<TeamResult> {
  const { userId } = await requireAccountOwner(accountId);
  const email = String(formData.get("email") ?? "").trim();
  if (!isValidEmail(email)) return { ok: false, error: "team.invite.badEmail" };
  const rawRole = formData.get("role");
  const role = rawRole === null || rawRole === "" ? "staff" : rawRole;
  if (!isAccountRole(role)) return { ok: false, error: "team.invite.failed" };
  const rawLanguage = formData.get("language");
  return invite(accountId, userId, { email, role, language: isPersonLanguage(rawLanguage) ? rawLanguage : null });
}

export async function setTeamRoleAction(
  accountId: string, userId: string, role: AccountRole,
): Promise<TeamResult & { previous?: AccountRole }> {
  await requireAccountOwner(accountId);
  if (!isTeamUserId(userId) || !isAccountRole(role)) return { ok: false, error: "team.changed" };
  const db = serviceDb();
  const member = await findMember(db, accountId, userId);
  if (!member) return { ok: false, error: "team.changed" };
  const previous = member.role;
  const account = await readAccount(db, accountId);

  // BIS first: the last-Owner guard decides.
  const r = await setAccountMemberRole(db, accountId, userId, role);
  if (r === "last_owner") return { ok: false, error: "team.lastOwner" };
  if (r === "not_found") return { ok: false, error: "team.changed" };

  // Then Clerk follows, retried once.
  let clerk = await setOrganizationRole(account.orgId, member.clerkUserId, role);
  if (!clerk.ok) clerk = await setOrganizationRole(account.orgId, member.clerkUserId, role);
  if (!clerk.ok) {
    try {
      const back = await setAccountMemberRole(db, accountId, userId, previous);
      if (back !== "ok") throw new Error(`rollback returned ${back}`);
    } catch (e) {
      console.error(
        `team: role rollback failed; BIS has ${role} but Clerk kept the role for ${previous} ` +
        `(account ${accountId}, user ${userId}): ${loggableError(e)}`);
    }
    return { ok: false, error: "team.role.failed" };
  }
  revalidateTeam(accountId);
  return { ok: true, previous };
}

export async function setTeamLanguageAction(
  accountId: string, userId: string, language: PersonLanguage | null,
): Promise<TeamResult & { previous?: PersonLanguage | null }> {
  await requireAccountOwner(accountId);
  if (!isTeamUserId(userId) || !(language === null || isPersonLanguage(language))) return { ok: false, error: "team.changed" };
  const db = serviceDb();
  const member = await findMember(db, accountId, userId);
  if (!member) return { ok: false, error: "team.changed" };
  const r = await setMemberLanguage(db, accountId, userId, language);
  if (r === "not_found") return { ok: false, error: "team.changed" };
  revalidateTeam(accountId);
  return { ok: true, previous: member.language };
}

export async function removeTeamMemberAction(
  accountId: string, userId: string,
): Promise<TeamResult & { undo?: { clerkUserId: string; role: AccountRole } }> {
  await requireAccountOwner(accountId);
  if (!isTeamUserId(userId)) return { ok: false, error: "team.changed" };
  const db = serviceDb();
  const member = await findMember(db, accountId, userId);
  if (!member) return { ok: false, error: "team.changed" };
  const account = await readAccount(db, accountId);

  // BIS first: the last-Owner guard decides.
  const r = await removeAccountMember(db, accountId, userId);
  if (r === "last_owner") return { ok: false, error: "team.lastOwner" };
  if (r === "not_found") return { ok: false, error: "team.changed" };

  const clerk = await removeFromOrganization(account.orgId, member.clerkUserId);
  if (!clerk.ok) {
    await addAccountMember(db, { accountId, userId, role: member.role });
    return { ok: false, error: "team.remove.failed" };
  }
  revalidateTeam(accountId);
  return { ok: true, undo: { clerkUserId: member.clerkUserId, role: member.role } };
}

/**
 * Clerk first (at the Clerk role matching `role`), then the BIS membership.
 * The person's `users` row, and with it their language, was never deleted,
 * so the language comes back as it was. Refused for anyone BIS has never
 * stored.
 */
export async function undoRemoveTeamMemberAction(
  accountId: string, clerkUserId: string, role: AccountRole,
): Promise<TeamResult> {
  await requireAccountOwner(accountId);
  if (!isClerkUserId(clerkUserId) || !isAccountRole(role)) return { ok: false, error: "team.undo.failed" };
  const db = serviceDb();
  const { data: user, error } = await db.from("users").select("id").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`team undo: user lookup failed: ${error.message}`);
  if (!user) return { ok: false, error: "team.undo.failed" };
  const account = await readAccount(db, accountId);

  const clerk = await restoreToOrganization(account.orgId, clerkUserId, role);
  if (!clerk.ok) return { ok: false, error: "team.undo.failed" };
  await addAccountMember(db, { accountId, userId: (user as { id: string }).id, role });
  revalidateTeam(accountId);
  return { ok: true };
}

export async function revokeTeamInvitationAction(
  accountId: string, invitationId: string,
): Promise<TeamResult & { undo?: { email: string; role: AccountRole; language: PersonLanguage } }> {
  await requireAccountOwner(accountId);
  if (!isInvitationId(invitationId)) return { ok: false, error: "team.revoke.failed" };
  const account = await readAccount(serviceDb(), accountId);
  // Scoped by the org in Clerk's own path, so another org's invitation id
  // finds nothing here.
  const r = await revokeTeamInvitation(account.orgId, invitationId);
  if (!r.ok) return { ok: false, error: "team.revoke.failed" };
  revalidateTeam(accountId);
  return { ok: true, undo: { email: r.invite.email, role: r.invite.role, language: r.invite.language } };
}

/** Re-invites with what the revoke returned. Clerk sends a fresh email; the undo toast says so (Task 10). */
export async function undoRevokeTeamInvitationAction(
  accountId: string, email: string, role: AccountRole, language: PersonLanguage,
): Promise<TeamResult> {
  const { userId } = await requireAccountOwner(accountId);
  if (!isValidEmail(email)) return { ok: false, error: "team.invite.badEmail" };
  if (!isAccountRole(role) || !isPersonLanguage(language)) return { ok: false, error: "team.invite.failed" };
  return invite(accountId, userId, { email: email.trim(), role, language });
}
