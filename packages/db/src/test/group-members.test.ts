import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity, listOpenDealsFor } from "../opportunities";
import { addPlace, listGroupPlaces } from "../places";
import {
  createGroupWithMember, addContactToGroup, removeMembership, listGroupMembers, countGroupMembers, listGroupPeople,
  setGroupPrimaryContact, GROUP_MEMBERS_PAGE_SIZE,
} from "../client-groups";

/**
 * S-03 part 2 (spec §6, C10, C12, C13): the group record page's reads and its one write, over
 * PostgREST on the service client. RLS for the same SQL shapes under a Technician's claims is
 * proven in client-groups-rls.test.ts (plan deviation 10).
 */
const A = "user_test";
const RUN = Math.random().toString(36).slice(2, 8);

async function household(db: SupabaseClient, accountId: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push((await createContact(db, accountId, { firstName: `P${i}`, lastName: "Garcia", email: `gm-${RUN}-${ids.length}-${Math.random().toString(36).slice(2, 6)}@example.com` }, A)).id);
  }
  const g = await createGroupWithMember(db, accountId, ids[0]!, "household", `Garcia ${RUN} ${Math.random().toString(36).slice(2, 6)}`, null, A);
  if (g.status !== "ok") throw new Error(g.status);
  const members = [g.memberId];
  for (const id of ids.slice(1)) {
    const r = await addContactToGroup(db, accountId, id, g.groupId, null, A);
    if (r.status !== "ok") throw new Error(r.status);
    members.push(r.memberId);
  }
  return { groupId: g.groupId, contactIds: ids, memberIds: members };
}

const noFields = { landmark: null, directions: null, city: null, region: null, postal_code: null, country: null } as const;

describe("group members (S-03 part 2, spec §6)", () => {
  it("pins the call-first member and never repeats them in the rows; primary comes back on a later page too (C10; plan deviation 3; mutation: drop .eq('is_primary_contact', false) -> the holder appears twice, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 3);
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[1]!, A)).toEqual({ status: "ok", previous: null });
      const page = await listGroupMembers(db, accountId, h.groupId);
      expect(page.primary?.memberId).toBe(h.memberIds[1]);
      expect(page.primary?.isPrimaryContact).toBe(true);
      expect(page.primary).toMatchObject({ contactId: h.contactIds[1], firstName: "P1", lastName: "Garcia" });
      expect(page.members.map((m) => m.memberId)).toEqual([h.memberIds[0], h.memberIds[2]]);
      expect(page.next).toBeNull();
      const later = await listGroupMembers(db, accountId, h.groupId, { after: { v: page.members[0]!.joinedAt, id: page.members[0]!.memberId } });
      expect(later.primary?.memberId).toBe(h.memberIds[1]);
      expect(later.members.map((m) => m.memberId)).toEqual([h.memberIds[2]]);
    }));

  it("31 members page as 30 then 1, no row lost or repeated at a created_at tie (mutation: compare created_at only in the cursor filter -> the tied row is lost or repeated, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 31);
      // The last two memberships share one instant, far past every other row's, so the page boundary
      // (row 30 of 31) falls ON the tie whenever this runs. The service role may write created_at
      // (0069 revokes only the client role).
      const tie = "2099-01-01T12:00:00.000001+00:00";
      const { error } = await db.from("client_group_members").update({ created_at: tie })
        .eq("account_id", accountId).in("id", [h.memberIds[29]!, h.memberIds[30]!]);
      if (error) throw new Error(error.message);
      const first = await listGroupMembers(db, accountId, h.groupId);
      expect(first.members).toHaveLength(GROUP_MEMBERS_PAGE_SIZE);
      expect(first.next).not.toBeNull();
      const second = await listGroupMembers(db, accountId, h.groupId, { after: first.next! });
      expect(second.next).toBeNull();
      const all = [...first.members, ...second.members].map((m) => m.memberId);
      expect(all).toHaveLength(31);
      expect(new Set(all).size).toBe(31);
      expect(await countGroupMembers(db, accountId, h.groupId)).toBe(31);
    }));

  it("listGroupPeople is the first `limit` by joined order, with names (mutation: order created_at descending -> P2, P1, FAILS; mutation: drop .limit(limit) -> three rows, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 3);
      expect(await listGroupPeople(db, accountId, h.groupId, 2)).toEqual([
        { contactId: h.contactIds[0], firstName: "P0", lastName: "Garcia" },
        { contactId: h.contactIds[1], firstName: "P1", lastName: "Garcia" },
      ]);
    }));

  it("setGroupPrimaryContact refuses a member of another group and names the previous holder on a swap (mutation: drop the wrapper's status check -> returns ok instead of not_found, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 2);
      const other = await household(db, accountId, 1);
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, other.memberIds[0]!, A)).toEqual({ status: "not_found" });
      await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[0]!, A);
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[1]!, A)).toEqual({ status: "ok", previous: h.memberIds[0] });
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, null, A)).toEqual({ status: "ok", previous: h.memberIds[1] });
      expect((await listGroupMembers(db, accountId, h.groupId)).primary).toBeNull();
    }));

  it("removing the holder records wasPrimaryContact on its event, and the snapshot carries the flag (spec §10; mutation: drop wasPrimaryContact from the payload -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 2);
      await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[0]!, A);
      const r = await removeMembership(db, accountId, h.memberIds[0]!, A);
      if (r.status !== "ok") throw new Error(r.status);
      expect(r.removed.is_primary_contact).toBe(true);
      const { data, error } = await db.from("events").select("payload").eq("account_id", accountId)
        .eq("type", "client_group.member_removed").contains("payload", { memberId: h.memberIds[0] });
      if (error) throw new Error(error.message);
      expect((data ?? []).map((e) => (e.payload as { wasPrimaryContact?: boolean }).wasPrimaryContact)).toEqual([true]);
      // And a member who did not hold it says so, rather than leaving the field out.
      const r2 = await removeMembership(db, accountId, h.memberIds[1]!, A);
      if (r2.status !== "ok") throw new Error(r2.status);
      const { data: d2, error: e2 } = await db.from("events").select("payload").eq("account_id", accountId)
        .eq("type", "client_group.member_removed").contains("payload", { memberId: h.memberIds[1] });
      if (e2) throw new Error(e2.message);
      expect((d2 ?? []).map((e) => (e.payload as { wasPrimaryContact?: boolean }).wasPrimaryContact)).toEqual([false]);
    }));

  it("listGroupPlaces returns the group's own places and never a member's own (C12; mutation: reuse listContactPlaces' contact_id-or-group filter -> the member's own place appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 1);
      const shared = await addPlace(db, accountId, { contactId: null, groupId: h.groupId },
        { label: "The house", address: "1 Main St", ...noFields },
        { subjectId: h.groupId, subjectKind: "group", actorId: A });
      await addPlace(db, accountId, { contactId: h.contactIds[0]!, groupId: null },
        { label: "Ana's shop", address: "2 Oak St", ...noFields },
        { subjectId: h.contactIds[0]!, actorId: A });
      const read = await listGroupPlaces(db, accountId, h.groupId);
      expect(read.places.map((p) => p.id)).toEqual([shared.id]);
      expect(read.placeCount).toBe(1);
      expect(read.groups).toEqual([]);
      // Events name the GROUP as the record a group-page change was made from, never a contactId.
      const { data, error } = await db.from("events").select("payload").eq("account_id", accountId).eq("type", "place.added")
        .contains("payload", { placeId: shared.id });
      if (error) throw new Error(error.message);
      expect(data?.[0]?.payload).toMatchObject({ groupId: h.groupId });
      expect(data?.[0]?.payload).not.toHaveProperty("contactId");
    }));

  it("listOpenDealsFor returns open deals only, newest first, with contact_id and an exact count (C13; mutation: drop .eq('status','open') -> the won deal appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 2);
      // Source, not the plan: ensureDefaultPipeline lives in crm-config.ts and answers { pipelineId }.
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const a = await createOpportunity(db, accountId, { contactId: h.contactIds[0]!, pipelineId, name: "Deck", value: 100 }, A);
      const b = await createOpportunity(db, accountId, { contactId: h.contactIds[1]!, pipelineId, name: "Roof", value: 200 }, A);
      const { error } = await db.from("opportunities").update({ status: "won" }).eq("id", a.id);
      if (error) throw new Error(error.message);
      const r = await listOpenDealsFor(db, accountId, h.contactIds);
      expect(r.deals.map((d) => [d.id, d.contact_id])).toEqual([[b.id, h.contactIds[1]]]);
      expect(r.count).toBe(1);
      expect(await listOpenDealsFor(db, accountId, [])).toEqual({ deals: [], count: 0 });
    }));
});
