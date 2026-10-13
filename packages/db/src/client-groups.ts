import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";
import { isTimelineInstant, type TimelineCursor } from "./timeline-cursor";

/**
 * Client groups (S-02 part 1, migration 0069): households and business
 * customers. The tables are SELECT-only for the client role; every write here
 * goes through a service-role plpgsql function or a service-client update,
 * so the CALLER must already have proven the contact, membership or group
 * through the request client (spec A1, the Technician spec's §7.3 rule).
 * contacts.company_name is kept by a trigger, never written here.
 */
export const GROUP_NAME_MAX = 120;
export const GROUP_ROLE_MAX = 60;
export const BILLING_ADDRESS_MAX = 300;

export type GroupKind = "household" | "business";
export type GroupMemberSnapshot = {
  id: string; account_id: string; client_group_id: string; contact_id: string;
  role: string | null; is_primary: boolean; is_billing: boolean;
  /** 0075: who we call first in the group (at most one per group). */
  is_primary_contact: boolean;
  created_at: string;
};
export type ContactGroupMember = { contactId: string; firstName: string | null; lastName: string | null };
export type ContactGroup = {
  memberId: string; groupId: string; kind: GroupKind; name: string; billingAddress: string | null;
  role: string | null; isPrimary: boolean; isBilling: boolean; others: ContactGroupMember[];
  /** Co-members past the first GROUP_OTHERS_SHOWN, counted among the rows the caller's RLS returns. */
  moreOthers: number;
};
/** The most co-members the card names per group; the rest are "and N more". */
export const GROUP_OTHERS_SHOWN = 10;
export type GroupSearchHit = { id: string; kind: GroupKind; name: string };
export type BusinessResult = {
  contactId: string; status: "ok" | "unchanged" | "not_found" | "too_long";
  removed: GroupMemberSnapshot | null; added: string | null;
};

/** A failed RPC, carrying PostgREST's error code (a SQLSTATE such as 40P01) beside the message. */
class RpcError extends Error {
  constructor(message: string, readonly code: string | undefined) { super(message); }
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new RpcError(`${fn} failed: ${error.message}`, error.code);
  return data as T;
}

/** Postgres's deadlock_detected. */
const DEADLOCK = "40P01";
/** How many times setContactsBusiness runs its RPC again after a deadlock (three calls at most). */
const DEADLOCK_RETRIES = 2;

/**
 * 0069's `app.group_ws()`: space, tab, LF, VT, FF, CR, U+00A0 — spelled with
 * the same code points, not JS's `.trim()`. `.trim()` strips a DIFFERENT
 * set (ECMA-262 WhiteSpace plus LineTerminator), which includes every
 * character here but ALSO others this database's class does not, U+FEFF
 * among them. That is not merely imprecise: a role of 58 ordinary
 * characters plus three U+FEFF is 61 characters by `app.group_ws()` (none
 * of them trimmed) but only 58 by `.trim()` (all three trimmed) — so a
 * `.trim()`-based guard reports it as fine while the database's own
 * `client_group_members_role_check` would still raise 23514 on it. Matches
 * `app.group_ws()` exactly, not a superset and not a subset.
 */
const GROUP_WS = /[ \t\n\v\f\r\u00a0]/;
export function dbTrimmedLength(value: string): number {
  let start = 0;
  let end = value.length;
  while (start < end && GROUP_WS.test(value[start]!)) start++;
  while (end > start && GROUP_WS.test(value[end - 1]!)) end--;
  return end - start;
}

/**
 * `client_group_members.role`'s own check (migration 0069,
 * `client_group_members_role_check`) is `char_length(role) between 1 and 60`
 * on the TRIMMED value `app.link_member` actually stores. Unguarded, a role
 * over GROUP_ROLE_MAX reaching create_group_with_member/add_contact_to_group
 * comes back as a raw 23514 wrapped in this file's generic "... failed: ..."
 * `Error` — not a status, unlike every other refusal these two hand back.
 * Checked here, before the RPC, so both still return a graceful status.
 */
function roleTooLong(role: string | null): boolean {
  return role !== null && dbTrimmedLength(role) > GROUP_ROLE_MAX;
}

type MemberRow = {
  id: string; role: string | null; is_primary: boolean; is_billing: boolean; created_at: string;
  client_groups: { id: string; kind: GroupKind; name: string; billing_address: string | null } | null;
};
type OtherRow = { client_group_id: string; contact_id: string; contacts: { first_name: string | null; last_name: string | null } | null };

/** The card's read. RLS alone decides what a Technician gets (G8): no role branch here. */
export async function listContactGroups(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactGroup[]> {
  const { data, error } = await db.from("client_group_members")
    .select("id, role, is_primary, is_billing, created_at, client_groups(id, kind, name, billing_address)")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`listContactGroups failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as MemberRow[])
    .filter((r) => r.client_groups !== null)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)
      || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  // One bounded read per group (a business can have hundreds of members). The exact count runs in the
  // same request, under the caller's RLS, so "and N more" never counts a member the caller cannot see.
  const others = new Map<string, { list: ContactGroupMember[]; more: number }>();
  await Promise.all(rows.map(async (row) => {
    const groupId = row.client_groups!.id;
    const { data: o, error: oErr, count } = await db.from("client_group_members")
      .select("client_group_id, contact_id, contacts(first_name, last_name)", { count: "exact" })
      .eq("account_id", accountId).eq("client_group_id", groupId).neq("contact_id", contactId)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(GROUP_OTHERS_SHOWN);
    if (oErr) throw new Error(`listContactGroups members failed: ${oErr.message}`);
    const list = ((o ?? []) as unknown as OtherRow[]).map((r) => (
      { contactId: r.contact_id, firstName: r.contacts?.first_name ?? null, lastName: r.contacts?.last_name ?? null }));
    others.set(groupId, { list, more: Math.max(0, (count ?? list.length) - list.length) });
  }));
  return rows.map((r) => ({
    memberId: r.id, groupId: r.client_groups!.id, kind: r.client_groups!.kind, name: r.client_groups!.name,
    billingAddress: r.client_groups!.billing_address, role: r.role, isPrimary: r.is_primary, isBilling: r.is_billing,
    others: others.get(r.client_groups!.id)?.list ?? [],
    moreOthers: others.get(r.client_groups!.id)?.more ?? 0,
  }));
}

export async function searchGroups(db: SupabaseClient, accountId: string, term: string): Promise<GroupSearchHit[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const s = sanitizeSearchTerm(trimmed);
  // A bare "%", "*" or "\" survives term.trim() (none are whitespace) but
  // sanitizes to "" — and `%${s}%` with s = "" is the pattern "%%", which
  // ILIKE matches against EVERY row, not none (contacts.ts's withSearch
  // idiom, :744-746). Same reasoning as the `!trimmed` guard above, one
  // step later: no real content left after sanitizing means no query.
  if (!s) return [];
  const { data, error } = await db.from("client_groups").select("id, kind, name")
    .eq("account_id", accountId).ilike("name", `%${s}%`).order("name_key", { ascending: true }).limit(8);
  if (error) throw new Error(`searchGroups failed: ${error.message}`);
  return (data ?? []) as GroupSearchHit[];
}

export async function readMembership(db: SupabaseClient, accountId: string, memberId: string) {
  const { data, error } = await db.from("client_group_members").select("contact_id, client_group_id")
    .eq("account_id", accountId).eq("id", memberId).maybeSingle();
  if (error) throw new Error(`readMembership failed: ${error.message}`);
  const row = data as { contact_id: string; client_group_id: string } | null;
  return row ? { contactId: row.contact_id, groupId: row.client_group_id } : null;
}

export async function readGroup(db: SupabaseClient, accountId: string, groupId: string) {
  const { data, error } = await db.from("client_groups").select("id, kind, name, billing_address")
    .eq("account_id", accountId).eq("id", groupId).maybeSingle();
  if (error) throw new Error(`readGroup failed: ${error.message}`);
  const row = data as { id: string; kind: GroupKind; name: string; billing_address: string | null } | null;
  return row ? { id: row.id, kind: row.kind, name: row.name, billingAddress: row.billing_address } : null;
}

/** The People card's page size, and the most members the page's activity reads (spec D7). */
export const GROUP_MEMBERS_PAGE_SIZE = 30;
export const GROUP_ACTIVITY_CAP = 50;

export type GroupMember = {
  memberId: string; contactId: string; firstName: string | null; lastName: string | null;
  phone: string | null; email: string | null; role: string | null; isBilling: boolean;
  isPrimaryContact: boolean; joinedAt: string;
};
export type GroupMembersPage = { primary: GroupMember | null; members: GroupMember[]; next: TimelineCursor | null };
export type GroupPerson = { contactId: string; firstName: string | null; lastName: string | null };

type GroupMemberRow = {
  id: string; contact_id: string; role: string | null; is_billing: boolean; is_primary_contact: boolean; created_at: string;
  contacts: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null;
};
// The composite-FK embed listContactGroups' co-member read already uses; contacts_technician_scope fences it again.
const GROUP_MEMBER_COLS = "id, contact_id, role, is_billing, is_primary_contact, created_at, contacts(first_name, last_name, phone, email)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toMember = (r: GroupMemberRow): GroupMember => ({
  memberId: r.id, contactId: r.contact_id, firstName: r.contacts?.first_name ?? null, lastName: r.contacts?.last_name ?? null,
  phone: r.contacts?.phone ?? null, email: r.contacts?.email ?? null, role: r.role, isBilling: r.is_billing,
  isPrimaryContact: r.is_primary_contact, joinedAt: r.created_at,
});

/** `(created_at, id) > (v, id)` for PostgREST's `.or()`; validated, then quoted (timeline-cursor.ts's rule). */
function membersAfterFilter(after: TimelineCursor): string {
  if (!isTimelineInstant(after.v) || !UUID.test(after.id)) throw new TypeError("group members cursor: malformed");
  const v = `"${after.v}"`;
  return `created_at.gt.${v},and(created_at.eq.${v},id.gt.${after.id.toLowerCase()})`;
}

/**
 * The group page's People (spec §6, C10): the call-first member, read on EVERY page because the
 * header calls them (plan deviation 3), then the rest in the order they joined, `limit` a page past
 * `after`, the holder excluded so they are never shown twice. RLS decides who is visible: a
 * Technician reads their own customers' memberships only (0069), so `primary` is null when the
 * holder is someone else's customer. THROWS on a read error or a malformed cursor (before any read).
 */
export async function listGroupMembers(
  db: SupabaseClient, accountId: string, groupId: string, opts: { after?: TimelineCursor; limit?: number } = {},
): Promise<GroupMembersPage> {
  const limit = opts.limit ?? GROUP_MEMBERS_PAGE_SIZE;
  const after = opts.after ? membersAfterFilter(opts.after) : null;
  let rest = db.from("client_group_members").select(GROUP_MEMBER_COLS)
    .eq("account_id", accountId).eq("client_group_id", groupId).eq("is_primary_contact", false);
  if (after) rest = rest.or(after);
  const [held, page] = await Promise.all([
    db.from("client_group_members").select(GROUP_MEMBER_COLS)
      .eq("account_id", accountId).eq("client_group_id", groupId).eq("is_primary_contact", true).maybeSingle(),
    rest.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit + 1),
  ]);
  if (held.error) throw new Error(`listGroupMembers primary failed: ${held.error.message}`);
  if (page.error) throw new Error(`listGroupMembers failed: ${page.error.message}`);
  const raw = (page.data ?? []) as unknown as GroupMemberRow[];
  const shown = raw.slice(0, limit);
  const last = shown.at(-1);
  const primaryRow = held.data as unknown as GroupMemberRow | null;
  return {
    primary: primaryRow && primaryRow.contacts ? toMember(primaryRow) : null,
    members: shown.filter((r) => r.contacts !== null).map(toMember),
    next: raw.length > limit && last ? { v: last.created_at, id: last.id } : null,
  };
}

/** The exact number of memberships the caller can see. THROWS on a read error or a count-less answer (#245). */
export async function countGroupMembers(db: SupabaseClient, accountId: string, groupId: string): Promise<number> {
  const { count, error } = await db.from("client_group_members").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("client_group_id", groupId);
  if (error) throw new Error(`countGroupMembers failed: ${error.message}`);
  if (count === null) throw new Error("countGroupMembers failed: no count returned");
  return count;
}

/** The first `limit` people by joined order (C13 in 2a: Deals' set), with their names. THROWS. */
export async function listGroupPeople(
  db: SupabaseClient, accountId: string, groupId: string, limit = GROUP_ACTIVITY_CAP,
): Promise<GroupPerson[]> {
  const { data, error } = await db.from("client_group_members").select("contact_id, contacts(first_name, last_name)")
    .eq("account_id", accountId).eq("client_group_id", groupId)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  if (error) throw new Error(`listGroupPeople failed: ${error.message}`);
  return ((data ?? []) as unknown as { contact_id: string; contacts: { first_name: string | null; last_name: string | null } | null }[])
    .filter((r) => r.contacts !== null)
    .map((r) => ({ contactId: r.contact_id, firstName: r.contacts!.first_name, lastName: r.contacts!.last_name }));
}

/**
 * Who we call first (0075's set_group_primary_contact). The CALLER must have proven the group and,
 * when given, the membership through the request client and checked the caller is a manager (C2).
 * `memberId` null clears. Answers the member that held it before, for the Undo.
 */
export async function setGroupPrimaryContact(
  db: SupabaseClient, accountId: string, groupId: string, memberId: string | null, actorId: string,
): Promise<{ status: "ok"; previous: string | null } | { status: "not_found" }> {
  const r = await rpc<{ status: string; previous?: string | null }>(
    db, "set_group_primary_contact", { p_account_id: accountId, p_group_id: groupId, p_member_id: memberId });
  if (r.status !== "ok") return { status: "not_found" };
  const previous = r.previous ?? null;
  // Choosing who already holds it (or clearing when nobody does) changed nothing: no event.
  if (previous !== memberId) {
    await emit(db, accountId, "client_group.member_updated", actorId,
      { groupId, memberId, previous, fields: ["is_primary_contact"] });
  }
  return { status: "ok", previous };
}

/**
 * Deviation from the brief's literal return type (see the task report): a
 * third status, `"too_long"`, ahead of `roleTooLong`'s check below.
 */
export async function createGroupWithMember(
  db: SupabaseClient, accountId: string, contactId: string, kind: GroupKind, name: string, role: string | null,
  actorId: string, actorType: ActorType = "user",
): Promise<
  | { status: "ok"; groupId: string; memberId: string; existed: boolean; name: string }
  | { status: "not_found" | "invalid_name" | "too_long" }
> {
  if (roleTooLong(role)) return { status: "too_long" };
  const r = await rpc<{ status: string; group_id?: string; member_id?: string; existed?: boolean; name?: string }>(
    db, "create_group_with_member", { p_account_id: accountId, p_contact_id: contactId, p_kind: kind, p_name: name, p_role: role });
  if (r.status !== "ok") return { status: r.status === "invalid_name" ? "invalid_name" : "not_found" };
  await emit(db, accountId, r.existed ? "client_group.member_added" : "client_group.created", actorId,
    { contactId, groupId: r.group_id, memberId: r.member_id, kind }, actorType);
  return { status: "ok", groupId: r.group_id!, memberId: r.member_id!, existed: r.existed === true, name: r.name! };
}

/** Deviation from the brief's literal return type: a third status, `"too_long"` (see createGroupWithMember). */
export async function addContactToGroup(
  db: SupabaseClient, accountId: string, contactId: string, groupId: string, role: string | null,
  actorId: string, actorType: ActorType = "user",
): Promise<{ status: "ok"; memberId: string } | { status: "not_found" | "too_long" }> {
  if (roleTooLong(role)) return { status: "too_long" };
  const r = await rpc<{ status: string; member_id?: string }>(
    db, "add_contact_to_group", { p_account_id: accountId, p_contact_id: contactId, p_group_id: groupId, p_role: role });
  if (r.status !== "ok") return { status: "not_found" };
  await emit(db, accountId, "client_group.member_added", actorId, { contactId, groupId, memberId: r.member_id }, actorType);
  return { status: "ok", memberId: r.member_id! };
}

/** The Business name write: the field, the CSV import (one call per batch) and the forms lead. */
export async function setContactsBusiness(
  db: SupabaseClient, accountId: string, rows: readonly { contactId: string; name: string }[],
  actorId: string, actorType: ActorType = "user",
): Promise<BusinessResult[]> {
  if (rows.length === 0) return [];
  type Row = { contact_id: string; status: BusinessResult["status"]; removed: GroupMemberSnapshot | null; added: string | null };
  const args = { p_account_id: accountId, p_contact_ids: rows.map((r) => r.contactId), p_names: rows.map((r) => r.name) };
  // set_contacts_business locks contacts in id order, but another writer (a reconcile, a cascade) can
  // still deadlock with it. One RPC is one transaction, so a 40P01 rolled back ALL of it: running it
  // again is safe, and nothing is emitted until a call has succeeded.
  let out: Row[];
  for (let attempt = 0; ; attempt++) {
    try {
      out = await rpc<Row[]>(db, "set_contacts_business", args);
      break;
    } catch (e) {
      if (!(e instanceof RpcError && e.code === DEADLOCK && attempt < DEADLOCK_RETRIES)) throw e;
    }
  }
  const results = out.map((r) => ({ contactId: r.contact_id, status: r.status, removed: r.removed, added: r.added }));
  // S-03 part 2 review fix: each business membership this write deleted is a removal, recorded as
  // removeMembership records one. A narrow caller's Undo is vouched for only by the NEWEST removal of
  // that member (groups-actions.ts's removedByCaller), so a delete with no event would leave an older
  // removal standing as the newest, and its call-first flag replayable.
  for (const r of results) {
    if (r.status === "ok" && r.removed) await emitRemoved(db, accountId, r.removed, actorId, actorType);
  }
  const changed = results.filter((r) => r.status === "ok").map((r) => r.contactId);
  if (changed.length > 0) {
    await emit(db, accountId, "client_group.business_set", actorId, { contactIds: changed }, actorType);
  }
  return results;
}

/** client_group.member_removed: the ids and whether the member was the group's call-first one. Never typed text. */
async function emitRemoved(
  db: SupabaseClient, accountId: string,
  row: Pick<GroupMemberSnapshot, "id" | "contact_id" | "client_group_id" | "is_primary_contact">,
  actorId: string, actorType: ActorType,
) {
  await emit(db, accountId, "client_group.member_removed", actorId,
    { memberId: row.id, contactId: row.contact_id, groupId: row.client_group_id, wasPrimaryContact: row.is_primary_contact === true },
    actorType);
}

/**
 * The Business name's Undo. undo_set_business deletes the membership the write ADDED (`added`) and
 * returns no row, so that membership is read first, on the same client, and its removal recorded by
 * the actor once the Undo has run (S-03 part 2 review fix; see setContactsBusiness). A failed read
 * throws before anything is deleted. The read is outside the RPC's contact lock: a call-first choice
 * landing between the two would not be in the event (a migration returning the deleted row closes it).
 */
export async function undoSetBusiness(
  db: SupabaseClient, accountId: string, contactId: string, added: string | null, removed: GroupMemberSnapshot | null,
  actorId: string, actorType: ActorType = "user",
): Promise<"ok" | "not_found"> {
  let doomed: Pick<GroupMemberSnapshot, "id" | "contact_id" | "client_group_id" | "is_primary_contact"> | null = null;
  if (added !== null) {
    const { data, error } = await db.from("client_group_members").select("id, contact_id, client_group_id, is_primary_contact")
      .eq("account_id", accountId).eq("id", added).eq("contact_id", contactId).maybeSingle();
    if (error) throw new Error(`undoSetBusiness member read failed: ${error.message}`);
    doomed = data as typeof doomed;
  }
  const r = await rpc<"ok" | "not_found">(db, "undo_set_business",
    { p_account_id: accountId, p_contact_id: contactId, p_added: added, p_removed: removed });
  if (r === "ok" && doomed) await emitRemoved(db, accountId, doomed, actorId, actorType);
  return r;
}

export async function setPrimaryMembership(db: SupabaseClient, accountId: string, memberId: string, actorId: string) {
  const r = await rpc<{ status: string; previous?: string | null }>(
    db, "set_primary_group_membership", { p_account_id: accountId, p_member_id: memberId });
  if (r.status !== "ok") return { status: "not_found" as const };
  await emit(db, accountId, "client_group.member_updated", actorId, { memberId, fields: ["is_primary"] });
  return { status: "ok" as const, previous: r.previous ?? null };
}

export async function removeMembership(db: SupabaseClient, accountId: string, memberId: string, actorId: string) {
  const r = await rpc<{ status: string; removed?: GroupMemberSnapshot }>(
    db, "remove_group_membership", { p_account_id: accountId, p_member_id: memberId });
  if (r.status !== "ok" || !r.removed) return { status: "not_found" as const };
  // Every id from the row the database deleted, never the caller's string (S-03 2a final review): jsonb
  // `@>` compares strings exactly, so a case-variant memberId would hide this removal from the lookup.
  await emit(db, accountId, "client_group.member_removed", actorId,
    { memberId: r.removed.id, contactId: r.removed.contact_id, groupId: r.removed.client_group_id,
      // S-03 part 2 (spec §10): a narrow caller's Undo restores the call-first flag only when THIS says so.
      wasPrimaryContact: r.removed.is_primary_contact === true });
  return { status: "ok" as const, removed: r.removed };
}

export async function restoreMembership(db: SupabaseClient, accountId: string, snapshot: GroupMemberSnapshot, actorId: string) {
  const r = await rpc<"ok" | "not_found">(db, "restore_group_membership", { p_account_id: accountId, p_snapshot: snapshot });
  if (r === "ok") {
    await emit(db, accountId, "client_group.member_added", actorId,
      { memberId: snapshot.id, contactId: snapshot.contact_id, groupId: snapshot.client_group_id, undo: true });
  }
  return r;
}

export async function updateMembership(
  db: SupabaseClient, accountId: string, memberId: string, patch: { role?: string | null; isBilling?: boolean }, actorId: string,
): Promise<{ status: "ok"; previous: { role: string | null; isBilling: boolean } } | { status: "not_found" }> {
  const { data: cur, error: readErr } = await db.from("client_group_members").select("role, is_billing")
    .eq("account_id", accountId).eq("id", memberId).maybeSingle();
  if (readErr) throw new Error(`updateMembership read failed: ${readErr.message}`);
  if (!cur) return { status: "not_found" };
  const row: Record<string, unknown> = {};
  if (patch.role !== undefined) row.role = patch.role === null || patch.role.trim() === "" ? null : patch.role.trim();
  if (patch.isBilling !== undefined) row.is_billing = patch.isBilling;
  const { error } = await db.from("client_group_members").update(row).eq("account_id", accountId).eq("id", memberId);
  if (error) throw new Error(`updateMembership failed: ${error.message}`);
  await emit(db, accountId, "client_group.member_updated", actorId, { memberId, fields: Object.keys(row) });
  const c = cur as { role: string | null; is_billing: boolean };
  return { status: "ok", previous: { role: c.role, isBilling: c.is_billing } };
}

export async function updateGroup(
  db: SupabaseClient, accountId: string, groupId: string, patch: { name?: string; billingAddress?: string | null }, actorId: string,
): Promise<{ status: "ok"; previous: { name: string; billingAddress: string | null } } | { status: "not_found" | "name_taken" }> {
  const cur = await readGroup(db, accountId, groupId);
  if (!cur) return { status: "not_found" };
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.billingAddress !== undefined) {
    row.billing_address = patch.billingAddress === null || patch.billingAddress.trim() === "" ? null : patch.billingAddress.trim();
  }
  const { error } = await db.from("client_groups").update(row).eq("account_id", accountId).eq("id", groupId);
  if (error?.code === "23505") return { status: "name_taken" };
  if (error) throw new Error(`updateGroup failed: ${error.message}`);
  await emit(db, accountId, "client_group.renamed", actorId, { groupId, fields: Object.keys(row).filter((k) => k !== "updated_at") });
  return { status: "ok", previous: { name: cur.name, billingAddress: cur.billingAddress } };
}
