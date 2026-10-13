"use server";

import { revalidatePath } from "next/cache";
import {
  serviceDb, getContact, readMembership, readGroup, searchGroups, createGroupWithMember, addContactToGroup,
  updateMembership, setPrimaryMembership, removeMembership, restoreMembership, updateGroup, setGroupPrimaryContact,
  GROUP_NAME_MAX, GROUP_ROLE_MAX, BILLING_ADDRESS_MAX, dbTrimmedLength,
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
/** S-03 part 2: the group's own record page, which shows its members and who we call first. */
const groupPath = (accountId: string, groupId: string) => `/dashboard/accounts/${accountId}/groups/${groupId}`;

/**
 * Fix round 1, I1: a group write can change contacts.company_name (0069's
 * trigger), which the list AND the contact's own page show. Revalidates the
 * list and that contact's page. The pages are force-dynamic, so this busts no
 * data cache; it is what tells Next the open page is stale, rather than
 * relying on its current habit of re-rendering any open page after any
 * revalidatePath (revalidate.js: "TODO: only revalidate if the path matches").
 */
function revalidateContacts(accountId: string, contactId: string) {
  revalidatePath(contactsPath(accountId));
  revalidatePath(`${contactsPath(accountId)}/${contactId}`);
}

/**
 * Spec §8: every explicit refusal is logged, one line. The reason and the ids
 * only, never a name (these are a client's customers); an id that is not a
 * uuid came from the browser and is logged as "invalid", never echoed.
 */
function refuse(label: string, accountId: string, why: string, ids: Record<string, unknown> = {}) {
  const at = Object.entries(ids).map(([k, v]) => `${k} ${typeof v === "string" && isUuid(v) ? v : "invalid"}`).join(", ");
  console.warn(`${label}: account ${accountId}: groups.refused (${why})${at ? `: ${at}` : ""}`);
  return refused;
}

async function guarded<T>(label: string, accountId: string, run: () => Promise<GroupResult<T>>): Promise<GroupResult<T>> {
  try { return await run(); } catch (e) {
    console.error(`${label}: account ${accountId}: ${loggableError(e)}`);
    return failed;
  }
}

/**
 * S-03 2a final review: an id from the browser, lowercased as PostgREST stores and echoes it, before
 * any read, write, event payload or jsonb lookup. Postgres casts uuid text case-insensitively but jsonb
 * `@>` compares strings exactly, so a case-variant id would write events that no lowercase lookup
 * matches (removedByCaller's newest-removal rule would never see them). A non-uuid is left as it came,
 * for the uuid checks to refuse.
 */
const canonical = <T,>(id: T): T => (isUuid(id) ? (id.toLowerCase() as T) : id);

async function provenMembership(accountId: string, memberId: string) {
  if (!isUuid(memberId)) return null;
  return readMembership(await dbForRequest(), accountId, memberId);
}

/** Tagged (fix round 1, I2): a failed search is `{ ok: false }`, which the card
 *  shows as its own error line, never `[]`, which reads as "no matches". */
export type GroupSearchResult = { ok: true; hits: GroupSearchHit[] } | { ok: false };

export async function searchGroupsAction(accountId: string, term: string): Promise<GroupSearchResult> {
  await requireAccountAccess(accountId);
  if (typeof term !== "string" || term.length > GROUP_NAME_MAX) return { ok: true, hits: [] };
  try {
    return { ok: true, hits: await searchGroups(await dbForRequest(), accountId, term) };
  } catch (e) {
    console.error(`searchGroupsAction: account ${accountId}: ${loggableError(e)}`);
    return { ok: false };
  }
}

export async function createGroupAction(
  accountId: string, rawContactId: string, kind: GroupKind, name: string,
): Promise<GroupResult<{ memberId: string; name: string; existed: boolean }>> {
  const { userId } = await requireAccountAccess(accountId);
  const L = "createGroupAction";
  const contactId = canonical(rawContactId);
  if (!isUuid(contactId) || (kind !== "household" && kind !== "business")) return refuse(L, accountId, "bad input", { contact: contactId });
  // Measured as 0069 trims it (app.group_ws()), not by .trim(), which also strips U+FEFF and others.
  if (typeof name !== "string" || dbTrimmedLength(name) === 0) return failed;
  if (dbTrimmedLength(name) > GROUP_NAME_MAX) return tooLong;
  return guarded<{ memberId: string; name: string; existed: boolean }>(L, accountId, async () => {
    if (!(await getContact(await dbForRequest(), accountId, contactId))) return refuse(L, accountId, "contact not visible", { contact: contactId });
    const r = await createGroupWithMember(serviceDb(), accountId, contactId, kind, name, null, userId);
    if (r.status !== "ok") return r.status === "invalid_name" ? failed : refuse(L, accountId, r.status, { contact: contactId });
    revalidateContacts(accountId, contactId);
    return { ok: true, memberId: r.memberId, name: r.name, existed: r.existed };
  });
}

export async function addToGroupAction(
  accountId: string, rawContactId: string, rawGroupId: string,
): Promise<GroupResult<{ memberId: string }>> {
  const { userId } = await requireAccountAccess(accountId);
  const L = "addToGroupAction";
  const contactId = canonical(rawContactId);
  const groupId = canonical(rawGroupId);
  const ids = { contact: contactId, group: groupId };
  if (!isUuid(contactId) || !isUuid(groupId)) return refuse(L, accountId, "bad input", ids);
  return guarded<{ memberId: string }>(L, accountId, async () => {
    const db = await dbForRequest();
    // Both proofs on the request client: the contact, and a group the caller can see (search showed it).
    if (!(await getContact(db, accountId, contactId)) || !(await readGroup(db, accountId, groupId))) {
      return refuse(L, accountId, "contact or group not visible", ids);
    }
    const r = await addContactToGroup(serviceDb(), accountId, contactId, groupId, null, userId);
    if (r.status !== "ok") return refuse(L, accountId, r.status, ids);
    // Joining a business rewrites contacts.company_name (0069's trigger), which the list and the page show.
    revalidateContacts(accountId, contactId);
    return { ok: true, memberId: r.memberId };
  });
}

export async function setRoleAction(
  accountId: string, rawMemberId: string, role: string | null,
): Promise<GroupResult<{ previous: string | null }>> {
  const { userId } = await requireAccountAccess(accountId);
  const memberId = canonical(rawMemberId);
  // null clears the role: the Undo of a first role sends back the previous value, which was null.
  if (role !== null && typeof role !== "string") return failed;
  if (role !== null && role.trim().length > GROUP_ROLE_MAX) return tooLong;
  const L = "setRoleAction";
  return guarded<{ previous: string | null }>(L, accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refuse(L, accountId, "membership not visible", { member: memberId });
    const r = await updateMembership(serviceDb(), accountId, memberId, { role }, userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.role } : refuse(L, accountId, r.status, { member: memberId });
  });
}

export async function setBillingAction(
  accountId: string, rawMemberId: string, isBilling: boolean,
): Promise<GroupResult<{ previous: boolean }>> {
  const { userId } = await requireAccountAccess(accountId);
  const memberId = canonical(rawMemberId);
  if (typeof isBilling !== "boolean") return failed;
  const L = "setBillingAction";
  return guarded<{ previous: boolean }>(L, accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refuse(L, accountId, "membership not visible", { member: memberId });
    const r = await updateMembership(serviceDb(), accountId, memberId, { isBilling }, userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.isBilling } : refuse(L, accountId, r.status, { member: memberId });
  });
}

export async function makePrimaryAction(
  accountId: string, rawMemberId: string,
): Promise<GroupResult<{ previous: string | null }>> {
  const { userId } = await requireAccountAccess(accountId);
  const L = "makePrimaryAction";
  const memberId = canonical(rawMemberId);
  return guarded<{ previous: string | null }>(L, accountId, async () => {
    const proven = await provenMembership(accountId, memberId);
    if (!proven) return refuse(L, accountId, "membership not visible", { member: memberId });
    const r = await setPrimaryMembership(serviceDb(), accountId, memberId, userId);
    if (r.status !== "ok") return refuse(L, accountId, r.status, { member: memberId });
    revalidateContacts(accountId, proven.contactId);
    return { ok: true, previous: r.previous };
  });
}

export async function removeMembershipAction(
  accountId: string, rawMemberId: string,
): Promise<GroupResult<{ removed: GroupMemberSnapshot }>> {
  const { userId } = await requireAccountAccess(accountId);
  const L = "removeMembershipAction";
  const memberId = canonical(rawMemberId);
  return guarded<{ removed: GroupMemberSnapshot }>(L, accountId, async () => {
    const proven = await provenMembership(accountId, memberId);
    if (!proven) return refuse(L, accountId, "membership not visible", { member: memberId });
    const r = await removeMembership(serviceDb(), accountId, memberId, userId);
    if (r.status !== "ok") return refuse(L, accountId, r.status, { member: memberId });
    revalidateContacts(accountId, proven.contactId);
    revalidatePath(groupPath(accountId, proven.groupId));
    return { ok: true, removed: r.removed };
  });
}

/**
 * I1: restore_group_membership checks only that the group is in the account,
 * so a snapshot is a claim from the browser. A caller who sees the whole
 * account could add that pair anyway. A narrow caller (a Technician, or a
 * role that could not be settled) gets the Undo only for a removal THEY
 * made: the client_group.member_removed event removeMembership emitted,
 * matched on the same member, contact and group in this account, read
 * through the service client because events are hidden from a Technician
 * (0068). Not a request-client readGroup: after removing the only link a
 * Technician had to a group, the group is invisible to them, and that Undo is
 * legitimate. Bounded to RESTORE_WINDOW_MS so the read stays on
 * events_account_created rather than the account's whole history.
 *
 * The NEWEST such removal, by ANY actor, decides both whether the Undo is
 * allowed and the call-first flag it restores (S-03 part 2 review fix).
 * restore puts the row back under its old id, so every earlier removal of
 * the same member still matches; were any of the caller's own removals
 * enough, a Technician could replay an older one (taken while the member
 * held the flag) after the Owner had removed the member again, or after the
 * flag was cleared and the member removed once more, and make their
 * customer the group's call-first member. Only the last removal says what
 * the row was when it last left: the caller's Undo stands only if that
 * removal was theirs, and its wasPrimaryContact is the flag. Ordered by
 * created_at then id (an identity, so it breaks a same-instant tie in
 * the order the events were written).
 */
const RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;
async function removedByCaller(
  accountId: string, userId: string, snapshot: GroupMemberSnapshot,
): Promise<{ found: boolean; wasPrimaryContact: boolean }> {
  const { data, error } = await serviceDb().from("events").select("id, actor_id, payload")
    .eq("account_id", accountId).eq("type", "client_group.member_removed")
    .contains("payload", { memberId: snapshot.id, contactId: snapshot.contact_id, groupId: snapshot.client_group_id })
    .gte("created_at", new Date(Date.now() - RESTORE_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(1);
  if (error) throw new Error(`restore removal lookup failed: ${error.message}`);
  const newest = (data ?? [])[0] as { actor_id?: unknown; payload?: { wasPrimaryContact?: unknown } } | undefined;
  if (!newest || newest.actor_id !== userId) return { found: false, wasPrimaryContact: false };
  // Only a literal true: removeMembership records the stored flag as a boolean (S-03 part 2).
  return { found: true, wasPrimaryContact: newest.payload?.wasPrimaryContact === true };
}

export async function restoreMembershipAction(accountId: string, raw: GroupMemberSnapshot): Promise<GroupResult> {
  const access = await requireAccountAccess(accountId);
  const { userId } = access;
  // The snapshot comes back from the browser: its ids are checked, and it must name THIS account.
  const L = "restoreMembershipAction";
  // Never the raw snapshot in the log: only its ids, each checked by refuse().
  const ids = { member: raw?.id, contact: raw?.contact_id, group: raw?.client_group_id };
  if (!raw || raw.account_id !== accountId
    || !isUuid(raw.contact_id) || !isUuid(raw.client_group_id) || !isUuid(raw.id)) {
    return refuse(L, accountId, "bad snapshot", ids);
  }
  // Lowercased before the lookup AND the restore (final review): the removal events name the stored,
  // lowercase ids, and jsonb `@>` would never match an uppercase one to them.
  const snapshot: GroupMemberSnapshot = {
    ...raw, id: raw.id.toLowerCase(), contact_id: raw.contact_id.toLowerCase(), client_group_id: raw.client_group_id.toLowerCase(),
  };
  return guarded<object>(L, accountId, async () => {
    if (!(await getContact(await dbForRequest(), accountId, snapshot.contact_id))) return refuse(L, accountId, "contact not visible", ids);
    let toRestore: GroupMemberSnapshot = snapshot;
    if (!seesWholeAccount(access)) {
      const removal = await removedByCaller(accountId, userId, snapshot);
      if (!removal.found) return refuse(L, accountId, "not the caller's removal", ids);
      // S-03 part 2 (spec §10, C2): the snapshot is a claim from the browser. Who we call first comes
      // back only when the caller's own removal event recorded that this member held it: a narrow
      // caller may not choose who the group's Call reaches, so an Undo cannot be a way to choose it.
      toRestore = { ...snapshot, is_primary_contact: removal.wasPrimaryContact };
    }
    const r = await restoreMembership(serviceDb(), accountId, toRestore, userId);
    if (r !== "ok") return refuse(L, accountId, r, ids);
    revalidateContacts(accountId, snapshot.contact_id);
    revalidatePath(groupPath(accountId, snapshot.client_group_id));
    return { ok: true };
  });
}

/** A6: Owner, Staff and the agency only (fails closed for a Technician and an unsettled role), and a group they can see. */
async function provenGroupForManager(access: Awaited<ReturnType<typeof requireAccountAccess>>, accountId: string, groupId: string) {
  if (!seesWholeAccount(access) || !isUuid(groupId)) return null;
  return readGroup(await dbForRequest(), accountId, groupId);
}

export async function renameGroupAction(
  accountId: string, rawGroupId: string, name: string,
): Promise<GroupResult<{ previous: string }>> {
  const access = await requireAccountAccess(accountId);
  const groupId = canonical(rawGroupId);
  if (typeof name !== "string" || name.trim().length === 0) return failed;
  if (name.trim().length > GROUP_NAME_MAX) return tooLong;
  const L = "renameGroupAction";
  return guarded<{ previous: string }>(L, accountId, async () => {
    if (!(await provenGroupForManager(access, accountId, groupId))) return refuse(L, accountId, "not a manager, or group not visible", { group: groupId });
    const r = await updateGroup(serviceDb(), accountId, groupId, { name }, access.userId);
    if (r.status === "name_taken") return { ok: false, error: "groups.nameTaken" };
    if (r.status !== "ok") return refuse(L, accountId, r.status, { group: groupId });
    // Every member's Business name can change (a business group). The list is revalidated here; the
    // open page is refreshed by the card itself (router.refresh() in GroupsCard's onChanged), and each
    // other member's page is force-dynamic with no staleTimes override, so it renders fresh when opened.
    // Not the literal route pattern this once passed, which revalidated every account's contact pages
    // (final review minor 9).
    revalidatePath(contactsPath(accountId));
    return { ok: true, previous: r.previous.name };
  });
}

export async function setBillingAddressAction(
  accountId: string, rawGroupId: string, address: string | null,
): Promise<GroupResult<{ previous: string | null }>> {
  const access = await requireAccountAccess(accountId);
  const groupId = canonical(rawGroupId);
  // null clears the address: the Undo of a first address sends back the previous value, which was null.
  if (address !== null && typeof address !== "string") return failed;
  if (address !== null && address.trim().length > BILLING_ADDRESS_MAX) return tooLong;
  const L = "setBillingAddressAction";
  return guarded<{ previous: string | null }>(L, accountId, async () => {
    if (!(await provenGroupForManager(access, accountId, groupId))) return refuse(L, accountId, "not a manager, or group not visible", { group: groupId });
    const r = await updateGroup(serviceDb(), accountId, groupId, { billingAddress: address }, access.userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.billingAddress } : refuse(L, accountId, r.status, { group: groupId });
  });
}

/**
 * Who we call first in a household or business (S-03 part 2, migration 0075). Owner, Staff and the
 * agency only (C2: it decides who the whole group's Call reaches, and a group can hold customers a
 * Technician does not serve), refused before any read for a narrow caller. The group and, when given,
 * the membership are proven on the request client, then 0075's function writes on the service client.
 * `memberId` null clears (the Undo of a first choice). A manager sees every membership, so one that is
 * not there has gone since (an Undo's `previous`): that is "didn't save", not "you can't" (plan
 * deviation 6).
 */
export async function setGroupPrimaryContactAction(
  accountId: string, rawGroupId: string, rawMemberId: string | null,
): Promise<GroupResult<{ previous: string | null }>> {
  const access = await requireAccountAccess(accountId);
  const L = "setGroupPrimaryContactAction";
  const ids = rawMemberId === null ? { group: rawGroupId } : { group: rawGroupId, member: rawMemberId };
  if (!isUuid(rawGroupId) || (rawMemberId !== null && !isUuid(rawMemberId))) return refuse(L, accountId, "bad input", ids);
  if (!seesWholeAccount(access)) return refuse(L, accountId, "not a manager", ids);
  // Lowercase as PostgREST stores and echoes them (review minor 2): setGroupPrimaryContact compares the
  // stored `previous` with memberId to skip a no-op's event, and the event and the path carry these ids.
  const groupId = rawGroupId.toLowerCase();
  const memberId = rawMemberId === null ? null : rawMemberId.toLowerCase();
  return guarded<{ previous: string | null }>(L, accountId, async () => {
    const db = await dbForRequest();
    if (!(await readGroup(db, accountId, groupId))) return refuse(L, accountId, "group not visible", ids);
    if (memberId !== null) {
      const proven = await readMembership(db, accountId, memberId);
      if (!proven) {
        console.warn(`${L}: account ${accountId}: groups.failed (membership gone): member ${memberId}`);
        return failed;
      }
      if (proven.groupId.toLowerCase() !== groupId) return refuse(L, accountId, "membership of another group", ids);
    }
    const r = await setGroupPrimaryContact(serviceDb(), accountId, groupId, memberId, access.userId);
    if (r.status !== "ok") {
      // Spec §10: a failure is logged, ids only. The group or member went between the proof and the write.
      console.warn(`${L}: account ${accountId}: groups.failed (not_found): group ${groupId}, member ${memberId ?? "none"}`);
      return failed;
    }
    revalidatePath(groupPath(accountId, groupId));
    return { ok: true, previous: r.previous };
  });
}
