"use server";

import { revalidatePath } from "next/cache";
import {
  serviceDb, getContact, readMembership, readGroup, searchGroups, createGroupWithMember, addContactToGroup,
  updateMembership, setPrimaryMembership, removeMembership, restoreMembership, updateGroup,
  GROUP_NAME_MAX, GROUP_ROLE_MAX, BILLING_ADDRESS_MAX,
  type GroupKind, type GroupMemberSnapshot, type GroupSearchHit,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";

/**
 * The Groups card's writes (S-02 §7). The group tables are server-written
 * (0069), so each action PROVES its target through the request client (RLS:
 * a Technician sees only their own customers and their memberships, G8),
 * then writes through the service client. Errors are catalogue KEYS; the
 * card renders them with m[...] (Task 6 adds the strings).
 *
 * requireAccountAccess always runs OUTSIDE `guarded`: it redirects by
 * throwing, and a redirect caught there would come back as "groups.failed".
 */
export type GroupActionError = "groups.refused" | "groups.failed" | "groups.nameTaken" | "groups.tooLong";
export type GroupResult<T = object> = ({ ok: true } & T) | { ok: false; error: GroupActionError };
const refused = { ok: false, error: "groups.refused" } as const;
const failed = { ok: false, error: "groups.failed" } as const;
const tooLong = { ok: false, error: "groups.tooLong" } as const;
const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

async function guarded<T>(label: string, accountId: string, run: () => Promise<GroupResult<T>>): Promise<GroupResult<T>> {
  try { return await run(); } catch (e) {
    console.error(`${label}: account ${accountId}: ${loggableError(e)}`);
    return failed;
  }
}

async function provenMembership(accountId: string, memberId: string) {
  if (!isUuid(memberId)) return null;
  return readMembership(await dbForRequest(), accountId, memberId);
}

export async function searchGroupsAction(accountId: string, term: string): Promise<GroupSearchHit[]> {
  await requireAccountAccess(accountId);
  if (typeof term !== "string" || term.length > GROUP_NAME_MAX) return [];
  return searchGroups(await dbForRequest(), accountId, term);
}

export async function createGroupAction(
  accountId: string, contactId: string, kind: GroupKind, name: string,
): Promise<GroupResult<{ memberId: string; name: string; existed: boolean }>> {
  const { userId } = await requireAccountAccess(accountId);
  if (!isUuid(contactId) || (kind !== "household" && kind !== "business")) return refused;
  if (typeof name !== "string" || name.trim().length === 0) return failed;
  if (name.trim().length > GROUP_NAME_MAX) return tooLong;
  return guarded<{ memberId: string; name: string; existed: boolean }>("createGroupAction", accountId, async () => {
    if (!(await getContact(await dbForRequest(), accountId, contactId))) return refused;
    const r = await createGroupWithMember(serviceDb(), accountId, contactId, kind, name, null, userId);
    if (r.status !== "ok") return r.status === "invalid_name" ? failed : refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, memberId: r.memberId, name: r.name, existed: r.existed };
  });
}

export async function addToGroupAction(
  accountId: string, contactId: string, groupId: string,
): Promise<GroupResult<{ memberId: string }>> {
  const { userId } = await requireAccountAccess(accountId);
  if (!isUuid(contactId) || !isUuid(groupId)) return refused;
  return guarded<{ memberId: string }>("addToGroupAction", accountId, async () => {
    const db = await dbForRequest();
    // Both proofs on the request client: the contact, and a group the caller can see (search showed it).
    if (!(await getContact(db, accountId, contactId)) || !(await readGroup(db, accountId, groupId))) return refused;
    const r = await addContactToGroup(serviceDb(), accountId, contactId, groupId, null, userId);
    if (r.status !== "ok") return refused;
    // Joining a business rewrites contacts.company_name (0069's trigger), which the list shows.
    revalidatePath(contactsPath(accountId));
    return { ok: true, memberId: r.memberId };
  });
}

export async function setRoleAction(
  accountId: string, memberId: string, role: string,
): Promise<GroupResult<{ previous: string | null }>> {
  const { userId } = await requireAccountAccess(accountId);
  if (typeof role !== "string") return failed;
  if (role.trim().length > GROUP_ROLE_MAX) return tooLong;
  return guarded<{ previous: string | null }>("setRoleAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await updateMembership(serviceDb(), accountId, memberId, { role }, userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.role } : refused;
  });
}

export async function setBillingAction(
  accountId: string, memberId: string, isBilling: boolean,
): Promise<GroupResult<{ previous: boolean }>> {
  const { userId } = await requireAccountAccess(accountId);
  if (typeof isBilling !== "boolean") return failed;
  return guarded<{ previous: boolean }>("setBillingAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await updateMembership(serviceDb(), accountId, memberId, { isBilling }, userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.isBilling } : refused;
  });
}

export async function makePrimaryAction(
  accountId: string, memberId: string,
): Promise<GroupResult<{ previous: string | null }>> {
  const { userId } = await requireAccountAccess(accountId);
  return guarded<{ previous: string | null }>("makePrimaryAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await setPrimaryMembership(serviceDb(), accountId, memberId, userId);
    if (r.status !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, previous: r.previous };
  });
}

export async function removeMembershipAction(
  accountId: string, memberId: string,
): Promise<GroupResult<{ removed: GroupMemberSnapshot }>> {
  const { userId } = await requireAccountAccess(accountId);
  return guarded<{ removed: GroupMemberSnapshot }>("removeMembershipAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await removeMembership(serviceDb(), accountId, memberId, userId);
    if (r.status !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, removed: r.removed };
  });
}

export async function restoreMembershipAction(accountId: string, snapshot: GroupMemberSnapshot): Promise<GroupResult> {
  const { userId } = await requireAccountAccess(accountId);
  // The snapshot comes back from the browser: its ids are checked, and it must name THIS account.
  if (!snapshot || snapshot.account_id !== accountId
    || !isUuid(snapshot.contact_id) || !isUuid(snapshot.client_group_id) || !isUuid(snapshot.id)) return refused;
  return guarded<object>("restoreMembershipAction", accountId, async () => {
    if (!(await getContact(await dbForRequest(), accountId, snapshot.contact_id))) return refused;
    const r = await restoreMembership(serviceDb(), accountId, snapshot, userId);
    if (r !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  });
}

/** A6: Owner, Staff and the agency only (fails closed for a Technician and an unsettled role), and a group they can see. */
async function provenGroupForManager(access: Awaited<ReturnType<typeof requireAccountAccess>>, accountId: string, groupId: string) {
  if (!seesWholeAccount(access) || !isUuid(groupId)) return null;
  return readGroup(await dbForRequest(), accountId, groupId);
}

export async function renameGroupAction(
  accountId: string, groupId: string, name: string,
): Promise<GroupResult<{ previous: string }>> {
  const access = await requireAccountAccess(accountId);
  if (typeof name !== "string" || name.trim().length === 0) return failed;
  if (name.trim().length > GROUP_NAME_MAX) return tooLong;
  return guarded<{ previous: string }>("renameGroupAction", accountId, async () => {
    if (!(await provenGroupForManager(access, accountId, groupId))) return refused;
    const r = await updateGroup(serviceDb(), accountId, groupId, { name }, access.userId);
    if (r.status === "name_taken") return { ok: false, error: "groups.nameTaken" };
    if (r.status !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, previous: r.previous.name };
  });
}

export async function setBillingAddressAction(
  accountId: string, groupId: string, address: string,
): Promise<GroupResult<{ previous: string | null }>> {
  const access = await requireAccountAccess(accountId);
  if (typeof address !== "string") return failed;
  if (address.trim().length > BILLING_ADDRESS_MAX) return tooLong;
  return guarded<{ previous: string | null }>("setBillingAddressAction", accountId, async () => {
    if (!(await provenGroupForManager(access, accountId, groupId))) return refused;
    const r = await updateGroup(serviceDb(), accountId, groupId, { billingAddress: address }, access.userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.billingAddress } : refused;
  });
}
