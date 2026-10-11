"use server";

import { revalidatePath } from "next/cache";
import {
  serviceDb, listAccountTeam, setAccountMemberRole, setMemberLanguage, removeAccountMember, addAccountMember,
  deleteAccountMembership, releaseMemberAssignments, reassignReleased,
  type AccountRole, type PersonLanguage, type ReleasedAssignments, type SupabaseClient, type TeamMember,
} from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import {
  teamCapacity, createTeamInvitation, revokeTeamInvitation, removeFromOrganization,
  restoreToOrganization, setOrganizationRole, clerkRefused,
} from "@/lib/team/clerk-team";
import {
  roomLeft, inviteDefaultLanguage, clerkInviteError, undoStillOpen,
  isTeamUserId, isInvitationId, isAccountRole, isPersonLanguage,
} from "@/lib/team/team-view";
import { recordRemoval, latestRemoval } from "@/lib/team/removal-log";
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
 * The Clerk role FOLLOWS the BIS role (owner -> org:admin, staff and
 * technician -> org:member). The dangerous disagreement is BIS Staff (or
 * Technician) beside Clerk org:admin: an org:admin can invite an Owner through Clerk's browser API.
 * So every failure path must land, if anywhere wrong, on BIS Owner beside
 * Clerk member, which only costs that person Clerk's own UI. That fixes the
 * ORDER of each role change (setTeamRoleAction) and why a Clerk timeout is
 * treated as "may still land" rather than as a refusal.
 */

export type TeamError =
  | "team.full" | "team.accessOff" | "team.lastOwner" | "team.changed"
  | "team.invite.badEmail" | "team.invite.alreadyInvited" | "team.invite.alreadyMember" | "team.invite.failed"
  | "team.role.failed" | "team.remove.failed" | "team.undo.failed" | "team.undo.expired" | "team.revoke.failed";
export type TeamResult = { ok: true } | { ok: false; error: TeamError };

type Account = { orgId: string; accessOn: boolean; language: unknown };

/** Named columns: `language` is 0065's (merged), the account-level default an invitation's language falls back to. */
async function readAccount(db: SupabaseClient, accountId: string): Promise<Account> {
  const { data, error } = await db.from("accounts").select("clerk_org_id, client_access_enabled, language").eq("id", accountId).maybeSingle();
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

/**
 * Demotion (to Staff, or since F-085 part 1 to Technician: any role but
 * Owner): Clerk FIRST (to org:member, with the new role as its bis_role),
 * then the BIS write with its last-Owner guard. If BIS refuses or fails,
 * Clerk is put back to the previous role; if THAT fails, BIS Owner beside
 * Clerk member is the safe side, logged by id. A Clerk demotion that times
 * out may still land later, which leaves the same safe pair. Once BIS holds
 * the new role, Clerk is set to it AGAIN (review I2): a concurrent
 * promotion's org:admin write may have landed between this action's two
 * writes.
 *
 * Promotion to Owner: BIS first (no last-Owner risk), then Clerk to
 * org:admin. Only a DEFINITIVE Clerk refusal (a 4xx, `clerkRefused`) rolls
 * back: Clerk is set back to org:member (best effort) BEFORE BIS is rolled
 * back, and if the set-back fails BIS is LEFT at Owner (safe) and logged.
 * Every other failure (a 5xx, a timeout, a network error) may have landed or
 * may land later (review I1), so BIS is left at Owner: rolling it back could
 * end at BIS Staff beside Clerk admin. After a Clerk write that landed, BIS
 * is re-read (review I2): if a concurrent demotion made the person Staff or
 * Technician meanwhile, or the read fails, Clerk goes back to org:member.
 * That set-back also writes the bis_role metadata roleFromClerk falls back
 * on, so it never names a role more privileged than BIS holds: the role BIS
 * now has, or Technician (the least) when the person is gone or unreadable.
 */
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
  const ids = `account ${accountId}, user ${userId}`;

  if (role !== "owner") {
    const demoted = await setOrganizationRole(account.orgId, member.clerkUserId, role);
    if (!demoted.ok) return { ok: false, error: "team.role.failed" };
    const putClerkBack = async () => {
      const back = await setOrganizationRole(account.orgId, member.clerkUserId, previous);
      if (!back.ok) console.error(`team: Clerk role not restored after a refused demotion; BIS ${previous}, Clerk member (${ids}): ${back.code ?? "no code"}`);
    };
    let r: Awaited<ReturnType<typeof setAccountMemberRole>>;
    try {
      r = await setAccountMemberRole(db, accountId, userId, role);
    } catch (e) {
      await putClerkBack();
      throw e;
    }
    if (r !== "ok") {
      await putClerkBack();
      return { ok: false, error: r === "last_owner" ? "team.lastOwner" : "team.changed" };
    }
    const again = await setOrganizationRole(account.orgId, member.clerkUserId, role);
    if (!again.ok) console.error(`team: the demotion's repeat Clerk write failed; BIS ${role}, Clerk possibly admin (${ids}): ${again.code ?? "no code"}`);
    revalidateTeam(accountId);
    return { ok: true, previous };
  }

  const r = await setAccountMemberRole(db, accountId, userId, "owner");
  if (r === "last_owner") return { ok: false, error: "team.lastOwner" };
  if (r === "not_found") return { ok: false, error: "team.changed" };
  const promoted = await setOrganizationRole(account.orgId, member.clerkUserId, "owner");
  if (!promoted.ok) {
    if (!clerkRefused(promoted)) {
      console.error(`team: promotion left at BIS owner; the Clerk write may have landed (${promoted.code ?? "no code"}, status ${promoted.status ?? "none"}) (${ids})`);
      revalidateTeam(accountId);
      return { ok: false, error: "team.role.failed" };
    }
    const setBack = await setOrganizationRole(account.orgId, member.clerkUserId, previous);
    if (!setBack.ok) {
      console.error(`team: promotion left at BIS owner; Clerk refused and the set-back failed (${ids})`);
      return { ok: false, error: "team.role.failed" };
    }
    try {
      const back = await setAccountMemberRole(db, accountId, userId, previous);
      if (back !== "ok") throw new Error(`rollback returned ${back}`);
    } catch (e) {
      console.error(`team: promotion rollback failed; BIS owner, Clerk member (${ids}): ${loggableError(e)}`);
    }
    return { ok: false, error: "team.role.failed" };
  }
  let now: AccountRole | null | "unread";
  try {
    now = (await findMember(db, accountId, userId))?.role ?? null;
  } catch (e) {
    console.error(`team: BIS role unreadable after the promotion's Clerk write (${ids}): ${loggableError(e)}`);
    now = "unread";
  }
  if (now !== "owner") {
    const back = await setOrganizationRole(account.orgId, member.clerkUserId, now === "staff" || now === "technician" ? now : "technician");
    if (!back.ok) console.error(`team: Clerk not set back to member after BIS changed under a promotion (${ids}): ${back.code ?? "no code"}`);
    revalidateTeam(accountId);
    return { ok: false, error: now === "unread" ? "team.role.failed" : "team.changed" };
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

/**
 * BIS first (the last-Owner guard), then the Clerk membership. A Clerk 404
 * already counts as removed (removeFromOrganization). Any other Clerk
 * failure re-adds the BIS row at its original role. Once both are gone, the
 * removal is recorded as a system event (lib/team/removal-log.ts): that
 * record, not the browser, is what the undo restores from. The undo handle
 * is the user id alone.
 *
 * Then the BIS membership is deleted AGAIN, an idempotent sweep (review I3):
 * a request from the person being removed, made while Clerk's delete was in
 * flight, could have recreated their row through the per-request fallback.
 * It runs after the record, so to survive it a fallback that read Clerk
 * before the delete must also have missed the record (reconcileMembership
 * refuses a membership older than it) AND written after this sweep.
 *
 * F-085 part 1 (spec §8, A3): once BIS and Clerk have both let the person
 * go, their customers and open tasks are released to Unassigned
 * (releaseMemberAssignments, 0068) and the ids ride in the removal record
 * for the undo. A release that fails never undoes the removal: it is logged
 * and tried once more straight away (it is idempotent), BEFORE the removal is
 * recorded, so the ids a successful retry released are in the record the
 * undo reads (fix round 1, review M1). If both fail, the record says nothing
 * was released; until a release lands, the person who left reads nothing (A1).
 */
export async function removeTeamMemberAction(
  accountId: string, userId: string,
): Promise<TeamResult & { undo?: { userId: string } }> {
  const { userId: callerId } = await requireAccountOwner(accountId);
  if (!isTeamUserId(userId)) return { ok: false, error: "team.changed" };
  const db = serviceDb();
  const member = await findMember(db, accountId, userId);
  if (!member) return { ok: false, error: "team.changed" };
  const account = await readAccount(db, accountId);
  const ids = `account ${accountId}, user ${userId}`;

  const r = await removeAccountMember(db, accountId, userId);
  if (r === "last_owner") return { ok: false, error: "team.lastOwner" };
  if (r === "not_found") return { ok: false, error: "team.changed" };

  const clerk = await removeFromOrganization(account.orgId, member.clerkUserId);
  if (!clerk.ok) {
    try {
      await addAccountMember(db, { accountId, userId, role: member.role });
    } catch (e) {
      console.error(`team: remove rollback failed; Clerk still has the member, BIS does not (${ids}): ${loggableError(e)}`);
    }
    return { ok: false, error: "team.remove.failed" };
  }
  revalidateTeam(accountId);
  let released: ReleasedAssignments | undefined;
  for (const attempt of ["", " on the retry either"]) {
    try {
      released = await releaseMemberAssignments(db, accountId, userId);
      break;
    } catch (e) {
      console.error(`team: assignments not released${attempt} (${ids}): ${loggableError(e)}`);
    }
  }
  let recorded = true;
  try {
    await recordRemoval(db, accountId, callerId,
      { userId, clerkUserId: member.clerkUserId, role: member.role, language: member.language, released });
  } catch (e) {
    console.error(`team: removal not recorded, so it cannot be undone (${ids}): ${loggableError(e)}`);
    recorded = false;
  }
  try {
    await deleteAccountMembership(db, accountId, userId);
  } catch (e) {
    console.error(`team: post-removal sweep failed (${ids}): ${loggableError(e)}`);
  }
  return recorded ? { ok: true, undo: { userId } } : { ok: true };
}

/**
 * The removal's give-back (spec §8): only the ids it recorded, only those
 * still Unassigned (reassignReleased). Never fails the undo: by the time it
 * runs the person is back on the team, so a failure is logged with the
 * account, the person and the ids, and a second Undo runs it again
 * (fix round 1, review I2).
 */
async function giveBackReleased(
  db: SupabaseClient, accountId: string, userId: string, released: ReleasedAssignments,
): Promise<void> {
  if (released.contacts.length === 0 && released.tasks.length === 0) return;
  try {
    await reassignReleased(db, accountId, userId, released);
  } catch (e) {
    console.error(`team undo: the member is back but their released customers and tasks were not given back (account ${accountId}, user ${userId}; contacts ${released.contacts.join(",") || "none"}; tasks ${released.tasks.join(",") || "none"}): ${loggableError(e)}`);
  }
}

/**
 * Restores exactly what the newest system-written removal of this person
 * from THIS account says (Clerk id, role, language), and only within
 * UNDO_WINDOW_MS of it. A person never removed from this account is refused
 * before Clerk is asked. Clerk first, at the matching Clerk role, then the
 * BIS membership, set explicitly to the event's role when a row already
 * existed (the webhook can get there first). A double-clicked undo (Clerk:
 * already a member, BIS already at that role) is a success.
 *
 * Then (F-085 part 1, spec §8) the customers and open tasks the removal
 * released go back to the person, only those still Unassigned
 * (reassignReleased): anyone handed to someone else since stays where they
 * are. That give-back runs on its own (giveBackReleased): its failure never
 * turns a restored membership into a failed undo, and the double-click path
 * runs it too, so a second Undo heals a give-back the first one missed.
 */
export async function undoRemoveTeamMemberAction(accountId: string, userId: string): Promise<TeamResult> {
  await requireAccountOwner(accountId);
  if (!isTeamUserId(userId)) return { ok: false, error: "team.undo.failed" };
  const db = serviceDb();
  const removed = await latestRemoval(db, accountId, userId);
  if (!removed) return { ok: false, error: "team.undo.failed" };
  if (!undoStillOpen(removed.removedAt, Date.now())) return { ok: false, error: "team.undo.expired" };
  const account = await readAccount(db, accountId);
  const ids = `account ${accountId}, user ${userId}`;

  const clerk = await restoreToOrganization(account.orgId, removed.clerkUserId, removed.role);
  if (!clerk.ok) {
    if (clerk.code === "already_a_member_in_organization" && (await findMember(db, accountId, userId))?.role === removed.role) {
      await giveBackReleased(db, accountId, userId, removed.released);
      return { ok: true };
    }
    return { ok: false, error: "team.undo.failed" };
  }
  try {
    const added = await addAccountMember(db, { accountId, userId, role: removed.role });
    if (added === "existed") {
      const set = await setAccountMemberRole(db, accountId, userId, removed.role);
      if (set !== "ok") console.error(`team undo: existing row not set to ${removed.role}: ${set} (${ids})`);
    }
    await setMemberLanguage(db, accountId, userId, removed.language);
  } catch (e) {
    console.error(`team undo: Clerk restored the member but the BIS membership was not restored (${ids}): ${loggableError(e)}`);
    return { ok: false, error: "team.undo.failed" };
  }
  await giveBackReleased(db, accountId, userId, removed.released);
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
