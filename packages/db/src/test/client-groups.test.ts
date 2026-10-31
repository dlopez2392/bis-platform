import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, getContact } from "../contacts";
import { serviceDb } from "../service";
import {
  listContactGroups, searchGroups, createGroupWithMember, addContactToGroup, setContactsBusiness, undoSetBusiness,
  setPrimaryMembership, removeMembership, restoreMembership, updateMembership, updateGroup, readMembership,
  GROUP_ROLE_MAX,
} from "../client-groups";

const A = "user_test";

describe("client-groups.ts over PostgREST", () => {
  it("lists a contact's groups main first, with the other members", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.g@example.com" }, A)).id;
    const luis = (await createContact(db, accountId, { firstName: "Luis", email: "luis.g@example.com" }, A)).id;
    const home = await createGroupWithMember(db, accountId, ana, "household", "Garcia", "Madre", A);
    if (home.status !== "ok") throw new Error(home.status);
    await addContactToGroup(db, accountId, luis, home.groupId, "Hijo", A);
    const biz = await createGroupWithMember(db, accountId, ana, "business", "Acme Roofing", null, A);
    if (biz.status !== "ok") throw new Error(biz.status);
    await setPrimaryMembership(db, accountId, biz.memberId, A);
    const groups = await listContactGroups(db, accountId, ana);
    expect(groups.map((g) => [g.name, g.kind, g.isPrimary])).toEqual([["Acme Roofing", "business", true], ["Garcia", "household", false]]);
    expect(groups[1]!.others).toEqual([{ contactId: luis, firstName: "Luis", lastName: null }]);
    expect(groups[1]!.moreOthers).toBe(0); // the exact count PostgREST answers equals the one name shown
    expect(groups[1]!.role).toBe("Madre");
  }));

  it("search finds by part of a name and treats % as a letter (mutation: drop sanitizeSearchTerm -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.s@example.com" }, A)).id;
      await createGroupWithMember(db, accountId, ana, "business", "Acme Roofing", null, A);
      await createGroupWithMember(db, accountId, ana, "household", "Garcia", null, A);
      expect((await searchGroups(db, accountId, "roof")).map((h) => h.name)).toEqual(["Acme Roofing"]);
      expect(await searchGroups(db, accountId, "%")).toEqual([]);
      expect(await searchGroups(db, accountId, "  ")).toEqual([]);
    }));

  // F-092 part 1 (plan Task 11, owner ruling Q4): a household is found the same way a contact is -
  // ignoring accents and word order - because 0108's client_groups.search_name folds the stored name the
  // same way app.contact_name_fold does. "garcia" alone already worked before this plan; what is new is
  // finding the accented, multi-word name by typing its folded words in either order, or in capitals.
  it("a household is found ignoring accents and word order (owner Q4)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.q4@example.com" }, A)).id;
      await createGroupWithMember(db, accountId, ana, "household", "Familia García", null, A);
      expect((await searchGroups(db, accountId, "familia garcia")).map((h) => h.name)).toEqual(["Familia García"]);
      expect((await searchGroups(db, accountId, "garcia familia")).map((h) => h.name)).toEqual(["Familia García"]);
      expect((await searchGroups(db, accountId, "GARCIA")).map((h) => h.name)).toEqual(["Familia García"]);
    }));

  it("the business name write keeps the column in step, and its undo restores it", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.b@example.com" }, A)).id;
    const [first] = await setContactsBusiness(db, accountId, [{ contactId: ana, name: "Acme Roofing" }], A);
    expect(first!.status).toBe("ok");
    expect((await getContact(db, accountId, ana))!.company_name).toBe("Acme Roofing");
    const [second] = await setContactsBusiness(db, accountId, [{ contactId: ana, name: "Beta Pools" }], A);
    expect(await undoSetBusiness(db, accountId, ana, second!.added, second!.removed, A)).toBe("ok");
    expect((await getContact(db, accountId, ana))!.company_name).toBe("Acme Roofing");
    // S-03 part 2 review fix: both deletes are recorded as removals (the rename's Acme membership, then
    // the Undo's Beta one), so the newest-removal rule in groups-actions.ts sees them.
    const { data, error } = await serviceDb().from("events").select("actor_id, payload")
      .eq("account_id", accountId).eq("type", "client_group.member_removed").order("id", { ascending: true });
    if (error) throw new Error(error.message);
    expect(data).toEqual([
      { actor_id: A, payload: { memberId: first!.added, contactId: ana, groupId: second!.removed!.client_group_id, wasPrimaryContact: false } },
      { actor_id: A, payload: { memberId: second!.added, contactId: ana, groupId: expect.any(String), wasPrimaryContact: false } },
    ]);
  }));

  it("remove then restore gives back the same membership; role and pays update; a rename onto another business is name_taken", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.r@example.com" }, A)).id;
      const acme = await createGroupWithMember(db, accountId, ana, "business", "Acme Roofing", null, A);
      const beta = await createGroupWithMember(db, accountId, ana, "business", "Beta Pools", null, A);
      if (acme.status !== "ok" || beta.status !== "ok") throw new Error("seed");
      expect(await updateMembership(db, accountId, acme.memberId, { role: "Dueña", isBilling: true }, A))
        .toEqual({ status: "ok", previous: { role: null, isBilling: false } });
      const removed = await removeMembership(db, accountId, acme.memberId, A);
      if (removed.status !== "ok") throw new Error("remove");
      expect(await readMembership(db, accountId, acme.memberId)).toBeNull();
      expect(await restoreMembership(db, accountId, removed.removed, A)).toBe("ok");
      expect(await readMembership(db, accountId, acme.memberId)).toEqual({ contactId: ana, groupId: acme.groupId });
      expect(await updateGroup(db, accountId, beta.groupId, { name: " acme ROOFING" }, A)).toEqual({ status: "name_taken" });
    }));

  it("account teardown leaves no group behind (mutation: take client_groups off ACCOUNT_OWNED_TABLES and make its account FK restrict -> FAILS)", async () => {
    let seen = "";
    await withTestAccount(async (db, accountId) => {
      seen = accountId;
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.t@example.com" }, A)).id;
      await createGroupWithMember(db, accountId, ana, "household", "Garcia", null, A);
    });
    const { count } = await serviceDb().from("client_groups").select("id", { count: "exact", head: true }).eq("account_id", seen);
    expect(count).toBe(0);
  });

  // Addition beyond the brief's literal Step 1 content: Task 1's implementer flagged that an
  // unguarded role over GROUP_ROLE_MAX (60) reaches client_group_members_role_check and comes
  // back as a raw 23514 wrapped in "... failed: ...", not a graceful status — unlike every other
  // row this module hands back. Guarded in createGroupWithMember/addContactToGroup before the RPC.
  it("a role over GROUP_ROLE_MAX is refused before it reaches the database (mutation: drop the roleTooLong guard -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.role@example.com" }, A)).id;
      const longRole = "x".repeat(GROUP_ROLE_MAX + 1);
      expect(await createGroupWithMember(db, accountId, ana, "household", "Garcia", longRole, A)).toEqual({ status: "too_long" });
      const home = await createGroupWithMember(db, accountId, ana, "household", "Reyes", null, A);
      if (home.status !== "ok") throw new Error(home.status);
      const luis = (await createContact(db, accountId, { firstName: "Luis", email: "luis.role@example.com" }, A)).id;
      expect(await addContactToGroup(db, accountId, luis, home.groupId, longRole, A)).toEqual({ status: "too_long" });
    }));
});
