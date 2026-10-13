import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { revalidatePath } from "next/cache";

const access = { userId: "user_1", isAgency: false, role: "technician" as string | null, canManage: false };
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn() }));
const REQUEST = { request: true };
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The service client: only restore's removal check reads through it directly (events).
const events = { data: [] as unknown[], error: null as null | { message: string } };
const chain = { select: vi.fn(), eq: vi.fn(), contains: vi.fn(), gte: vi.fn(), limit: vi.fn() };
const SERVICE = { service: true, from: vi.fn() };

const db = {
  serviceDb: vi.fn(),
  getContact: vi.fn(), readMembership: vi.fn(), readGroup: vi.fn(),
  searchGroups: vi.fn(), createGroupWithMember: vi.fn(), addContactToGroup: vi.fn(),
  updateMembership: vi.fn(), setPrimaryMembership: vi.fn(), removeMembership: vi.fn(), restoreMembership: vi.fn(),
  updateGroup: vi.fn(), setGroupPrimaryContact: vi.fn(), GROUP_NAME_MAX: 120, GROUP_ROLE_MAX: 60, BILLING_ADDRESS_MAX: 300,
};
// The REAL whitespace rule (0069's app.group_ws()), not a stand-in: m1 is about using it.
vi.mock("@bis/db", async () => ({
  ...db,
  dbTrimmedLength: (await vi.importActual<typeof import("../../../../../../../../../packages/db/src/client-groups")>(
    "../../../../../../../../../packages/db/src/client-groups")).dbTrimmedLength,
}));

const A = await import("./groups-actions");
const C = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const G = "33333333-3333-4333-8333-333333333333";
const snap = (over: Partial<{ account_id: string }> = {}) => ({
  id: M, account_id: "a1", client_group_id: G, contact_id: C, role: null, is_primary: false, is_billing: false, is_primary_contact: false, created_at: "x", ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  access.role = "technician"; access.isAgency = false;
  vi.mocked(requireAccountAccess).mockImplementation(async () => access as never);
  vi.mocked(dbForRequest).mockResolvedValue(REQUEST as never);
  db.serviceDb.mockReturnValue(SERVICE);
  events.data = []; events.error = null;
  SERVICE.from.mockReturnValue(chain);
  for (const k of ["select", "eq", "contains", "gte"] as const) chain[k].mockReturnValue(chain);
  chain.limit.mockImplementation(async () => ({ data: events.data, error: events.error }));
});

describe("every write proves its target through the request client first (mutation: skip the proof in any action, or move it to serviceDb -> its case FAILS)", () => {
  it("create: an unseen contact never reaches the service write", async () => {
    db.getContact.mockResolvedValue(null);
    expect(await A.createGroupAction("a1", C, "household", "Garcia")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.createGroupWithMember).not.toHaveBeenCalled();
  });
  it("add: an unseen contact, even with a visible group, never reaches the service write", async () => {
    db.getContact.mockResolvedValue(null);
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    expect(await A.addToGroupAction("a1", C, G)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.addContactToGroup).not.toHaveBeenCalled();
  });
  it("add: an unseen group, even with a visible contact, never reaches the service write", async () => {
    db.getContact.mockResolvedValue({ id: C });
    db.readGroup.mockResolvedValue(null);
    expect(await A.addToGroupAction("a1", C, G)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, "a1", G);
    expect(db.addContactToGroup).not.toHaveBeenCalled();
  });
  it("add: a proven pair is written through the SERVICE client and refreshes the contact list", async () => {
    db.getContact.mockResolvedValue({ id: C });
    db.readGroup.mockResolvedValue({ id: G, kind: "business", name: "Acme", billingAddress: null });
    db.addContactToGroup.mockResolvedValue({ status: "ok", memberId: M });
    expect(await A.addToGroupAction("a1", C, G)).toEqual({ ok: true, memberId: M });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, "a1", G);
    expect(db.addContactToGroup).toHaveBeenCalledWith(SERVICE, "a1", C, G, null, "user_1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
  });

  const membershipCases = [
    { name: "role", run: () => A.setRoleAction("a1", M, "Madre"), write: db.updateMembership,
      ok: { status: "ok", previous: { role: null, isBilling: false } }, args: [SERVICE, "a1", M, { role: "Madre" }, "user_1"] },
    { name: "pays", run: () => A.setBillingAction("a1", M, true), write: db.updateMembership,
      ok: { status: "ok", previous: { role: null, isBilling: false } }, args: [SERVICE, "a1", M, { isBilling: true }, "user_1"] },
    { name: "main", run: () => A.makePrimaryAction("a1", M), write: db.setPrimaryMembership,
      ok: { status: "ok", previous: null }, args: [SERVICE, "a1", M, "user_1"] },
    { name: "remove", run: () => A.removeMembershipAction("a1", M), write: db.removeMembership,
      ok: { status: "ok", removed: snap() }, args: [SERVICE, "a1", M, "user_1"] },
  ];
  it.each(membershipCases)("$name: an unseen membership never reaches the service write", async ({ run, write }) => {
    db.readMembership.mockResolvedValue(null);
    expect(await run()).toEqual({ ok: false, error: "groups.refused" });
    expect(db.readMembership).toHaveBeenCalledWith(REQUEST, "a1", M);
    expect(write).not.toHaveBeenCalled();
  });
  it.each(membershipCases)("$name: a membership proven on the REQUEST client is written through the SERVICE client", async ({ run, write, ok, args }) => {
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    write.mockResolvedValue(ok);
    expect((await run()).ok).toBe(true);
    expect(db.readMembership).toHaveBeenCalledWith(REQUEST, "a1", M);
    expect(write).toHaveBeenCalledWith(...args);
  });

  it("restore: the snapshot's contact must be one the caller can see", async () => {
    db.getContact.mockResolvedValue(null);
    expect((await A.restoreMembershipAction("a1", snap())).ok).toBe(false);
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
  it("restore: a snapshot naming another account is refused, even for a contact the caller can see (mutation: drop the account_id check -> FAILS)", async () => {
    access.role = "staff";
    db.getContact.mockResolvedValue({ id: C });
    db.restoreMembership.mockResolvedValue("ok");
    expect(await A.restoreMembershipAction("a1", snap({ account_id: "a2" }))).toEqual({ ok: false, error: "groups.refused" });
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
});

describe("I1: a narrow caller restores only a membership THEY removed (no Undo into a group they cannot see)", () => {
  it.each(["technician", null])("role %s, contact visible, no matching removal on record: refused, nothing written", async (role) => {
    access.role = role;
    db.getContact.mockResolvedValue({ id: C });
    db.readGroup.mockResolvedValue(null); // the group is NOT visible to them
    db.restoreMembership.mockResolvedValue("ok");
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: false, error: "groups.refused" });
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
  it("a Technician restoring their own just-removed membership succeeds, vouched by that exact removal event", async () => {
    db.getContact.mockResolvedValue({ id: C });
    db.restoreMembership.mockResolvedValue("ok");
    events.data = [{ id: 7 }];
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: true });
    expect(SERVICE.from).toHaveBeenCalledWith("events");
    expect(chain.eq).toHaveBeenCalledWith("account_id", "a1");
    expect(chain.eq).toHaveBeenCalledWith("type", "client_group.member_removed");
    expect(chain.eq).toHaveBeenCalledWith("actor_id", "user_1");
    expect(chain.contains).toHaveBeenCalledWith("payload", { memberId: M, contactId: C, groupId: G });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", snap(), "user_1");
  });
  it("the removal must be within the last 24 hours: the lookup is bounded by created_at (final review minor 7; mutation: drop the .gte(created_at) bound -> FAILS)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
      db.getContact.mockResolvedValue({ id: C });
      db.restoreMembership.mockResolvedValue("ok");
      events.data = [{ id: 7 }];
      expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: true });
      expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-10-10T12:00:00.000Z");
    } finally { vi.useRealTimers(); }
  });
  it("Staff keep today's behaviour: no removal check", async () => {
    access.role = "staff";
    db.getContact.mockResolvedValue({ id: C });
    db.restoreMembership.mockResolvedValue("ok");
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: true });
    expect(SERVICE.from).not.toHaveBeenCalled();
  });
  it("a failed removal lookup is groups.failed, never a write", async () => {
    db.getContact.mockResolvedValue({ id: C });
    events.error = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: false, error: "groups.failed" });
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
});

describe("S-03 part 2: who we call first is Owner, Staff and the agency's to choose (C2)", () => {
  const MB = "44444444-4444-4444-8444-444444444444";
  const GARCIA = { id: G, kind: "household", name: "Garcia", billingAddress: null };
  it("a Technician is refused before any read or service write (mutation: drop the seesWholeAccount check -> the service write runs, FAILS)", async () => {
    access.role = "technician";
    db.readGroup.mockResolvedValue(GARCIA);
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: null });
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.readGroup).not.toHaveBeenCalled();
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("an unsettled role (null) is refused the same way: the rule fails closed", async () => {
    access.role = null;
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.readGroup).not.toHaveBeenCalled();
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("Staff: group and membership proven on the REQUEST client, written on the SERVICE client, previous handed back (mutation: prove on serviceDb -> FAILS)", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue(GARCIA);
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: MB });
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: true, previous: MB });
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, "a1", G);
    expect(db.readMembership).toHaveBeenCalledWith(REQUEST, "a1", M);
    expect(db.setGroupPrimaryContact).toHaveBeenCalledWith(SERVICE, "a1", G, M, "user_1");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/groups/${G}`);
  });
  it("a group the request client cannot see is refused and never written (mutation: skip the readGroup proof -> FAILS)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue(null);
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: null });
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("a membership of ANOTHER group is refused (mutation: drop the groupId comparison -> written, FAILS)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue(GARCIA);
    db.readMembership.mockResolvedValue({ contactId: C, groupId: MB });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: null });
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("an Undo naming a membership that has gone is groups.failed and moves nothing (plan deviation 6; mutation: answer refused -> FAILS)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue(GARCIA);
    db.readMembership.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.failed" });
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("the database's not_found is groups.failed and revalidates nothing (mutation: ignore the status -> FAILS)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue(GARCIA);
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "not_found" });
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("null clears, with no membership read (the agency, whatever its role field says)", async () => {
    access.isAgency = true;
    db.readGroup.mockResolvedValue(GARCIA);
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: M });
    expect(await A.setGroupPrimaryContactAction("a1", G, null)).toEqual({ ok: true, previous: M });
    expect(db.readMembership).not.toHaveBeenCalled();
    expect(db.setGroupPrimaryContact).toHaveBeenCalledWith(SERVICE, "a1", G, null, "user_1");
  });
  it("a bad id is refused before any read (mutation: drop the isUuid checks -> readGroup runs, FAILS)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue(GARCIA);
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    expect(await A.setGroupPrimaryContactAction("a1", "nope", M)).toEqual({ ok: false, error: "groups.refused" });
    expect(await A.setGroupPrimaryContactAction("a1", G, "nope")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.readGroup).not.toHaveBeenCalled();
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
});

describe("S-03 part 2: a narrow caller's Undo restores the call-first flag only when THEIR removal held it (spec §10)", () => {
  beforeEach(() => { db.getContact.mockResolvedValue({ id: C }); db.restoreMembership.mockResolvedValue("ok"); });
  it("a snapshot claiming the flag, whose removal event lacks wasPrimaryContact, is restored WITHOUT it (mutation: pass the snapshot through -> FAILS)", async () => {
    events.data = [{ id: "e1", payload: { memberId: M, contactId: C, groupId: G } }];
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never)).toEqual({ ok: true });
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: false }), "user_1");
  });
  it("only a literal true counts: the text 'true' in a payload is not the flag (mutation: read it by truthiness -> FAILS)", async () => {
    events.data = [{ id: "e1", payload: { memberId: M, contactId: C, groupId: G, wasPrimaryContact: "true" } }];
    await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: false }), "user_1");
  });
  it("the removal event saying wasPrimaryContact restores the flag (mutation: always false -> FAILS)", async () => {
    events.data = [{ id: "e1", payload: { memberId: M, contactId: C, groupId: G, wasPrimaryContact: true } }];
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: false } as never)).toEqual({ ok: true });
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: true }), "user_1");
  });
  it("the lookup selects the payload it judges by (mutation: select id only -> FAILS)", async () => {
    events.data = [{ id: "e1", payload: { memberId: M, contactId: C, groupId: G } }];
    await A.restoreMembershipAction("a1", snap());
    expect(chain.select).toHaveBeenCalledWith("id, payload");
  });
  it("Staff's snapshot passes through as it came (they may choose the call-first member anyway)", async () => {
    access.role = "staff";
    await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: true }), "user_1");
  });
  it("restore and remove revalidate the group's own page too (mutation: drop either groupPath revalidate -> FAILS)", async () => {
    access.role = "staff";
    await A.restoreMembershipAction("a1", snap());
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/groups/${G}`);
    vi.mocked(revalidatePath).mockClear();
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.removeMembership.mockResolvedValue({ status: "ok", removed: snap() });
    await A.removeMembershipAction("a1", M);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/groups/${G}`);
  });
});

describe("A6: rename and billing address are Owner, Staff and agency only", () => {
  it.each(["technician", null])("role %s is refused even for a group they can see", async (role) => {
    access.role = role;
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    expect(await A.renameGroupAction("a1", G, "García")).toEqual({ ok: false, error: "groups.refused" });
    expect(await A.setBillingAddressAction("a1", G, "1 Main St")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.updateGroup).not.toHaveBeenCalled();
  });
  it("Staff renames a group proven on the REQUEST client; a taken business name reads as nameTaken", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue({ id: G, kind: "business", name: "Acme", billingAddress: null });
    db.updateGroup.mockResolvedValue({ status: "name_taken" });
    expect(await A.renameGroupAction("a1", G, "Beta")).toEqual({ ok: false, error: "groups.nameTaken" });
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, "a1", G);
    expect(db.updateGroup).toHaveBeenCalledWith(SERVICE, "a1", G, { name: "Beta" }, "user_1");
  });
  it("Staff's billing address is proven on the REQUEST client, and null clears it (the Undo of a first address)", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue({ id: G, kind: "business", name: "Acme", billingAddress: "1 Main St" });
    db.updateGroup.mockResolvedValue({ status: "ok", previous: { name: "Acme", billingAddress: "1 Main St" } });
    expect(await A.setBillingAddressAction("a1", G, null)).toEqual({ ok: true, previous: "1 Main St" });
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, "a1", G);
    expect(db.updateGroup).toHaveBeenCalledWith(SERVICE, "a1", G, { billingAddress: null }, "user_1");
  });
});

describe("input shape", () => {
  it("refuses a non-uuid id and an over-long name or role without touching the database", async () => {
    expect((await A.makePrimaryAction("a1", "nope")).ok).toBe(false);
    expect(await A.createGroupAction("a1", C, "household", "x".repeat(121))).toEqual({ ok: false, error: "groups.tooLong" });
    expect(await A.setRoleAction("a1", M, "x".repeat(61))).toEqual({ ok: false, error: "groups.tooLong" });
    expect(db.readMembership).not.toHaveBeenCalled();
  });
  it("create measures the name by the database's whitespace class, not .trim() (m1: U+FEFF is not trimmed by 0069)", async () => {
    const name = "x".repeat(118) + "﻿".repeat(3);
    expect(await A.createGroupAction("a1", C, "business", name)).toEqual({ ok: false, error: "groups.tooLong" });
    expect(db.getContact).not.toHaveBeenCalled();
  });
  it("an over-long billing address is tooLong before any read", async () => {
    access.role = "staff";
    expect(await A.setBillingAddressAction("a1", G, "x".repeat(301))).toEqual({ ok: false, error: "groups.tooLong" });
    expect(db.readGroup).not.toHaveBeenCalled();
  });
  it("a null role clears it (the Undo of a first role)", async () => {
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.updateMembership.mockResolvedValue({ status: "ok", previous: { role: "Madre", isBilling: false } });
    expect(await A.setRoleAction("a1", M, null)).toEqual({ ok: true, previous: "Madre" });
    expect(db.updateMembership).toHaveBeenCalledWith(SERVICE, "a1", M, { role: null }, "user_1");
  });
});

describe("search (fix round 1, I2: a failure the card can tell from no matches)", () => {
  it("hits come back tagged ok", async () => {
    db.searchGroups.mockResolvedValue([{ id: G, kind: "household", name: "Garcia" }]);
    expect(await A.searchGroupsAction("a1", "Gar")).toEqual({ ok: true, hits: [{ id: G, kind: "household", name: "Garcia" }] });
    expect(db.searchGroups).toHaveBeenCalledWith(REQUEST, "a1", "Gar");
  });
  it("a failed search is logged and comes back { ok: false }, never [] and never a throw (mutation: return { ok: true, hits: [] } -> FAILS)", async () => {
    db.searchGroups.mockRejectedValue(new Error("searchGroups failed: boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await A.searchGroupsAction("a1", "Gar")).toEqual({ ok: false });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("searchGroupsAction: account a1: Error: searchGroups failed: boom"));
  });
  it("an over-long term is no matches, not a failure, and never reaches the database", async () => {
    expect(await A.searchGroupsAction("a1", "x".repeat(121))).toEqual({ ok: true, hits: [] });
    expect(db.searchGroups).not.toHaveBeenCalled();
  });
});

/**
 * Fix round 1, I1: a group write can change contacts.company_name (0069's
 * trigger), which the contact's own page shows. Each write revalidates that
 * page as well as the list, so a refresh brings the new Business name, not
 * only Next's current habit of re-rendering whatever page is open.
 */
describe("fix round 1, I1: writes revalidate the contact's own page", () => {
  const detail = `/dashboard/accounts/a1/contacts/${C}`;
  it("create revalidates the list and that contact's page (mutation: list only -> FAILS)", async () => {
    db.getContact.mockResolvedValue({ id: C });
    db.createGroupWithMember.mockResolvedValue({ status: "ok", groupId: G, memberId: M, existed: false, name: "Garcia" });
    expect((await A.createGroupAction("a1", C, "household", "Garcia")).ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
    expect(revalidatePath).toHaveBeenCalledWith(detail);
  });
  it("add revalidates that contact's page", async () => {
    db.getContact.mockResolvedValue({ id: C });
    db.readGroup.mockResolvedValue({ id: G, kind: "business", name: "Acme", billingAddress: null });
    db.addContactToGroup.mockResolvedValue({ status: "ok", memberId: M });
    await A.addToGroupAction("a1", C, G);
    expect(revalidatePath).toHaveBeenCalledWith(detail);
  });
  it.each([
    { name: "main", run: () => A.makePrimaryAction("a1", M), write: db.setPrimaryMembership, ok: { status: "ok", previous: null } },
    { name: "remove", run: () => A.removeMembershipAction("a1", M), write: db.removeMembership, ok: { status: "ok", removed: snap() } },
  ])("$name revalidates the page of the contact the PROVEN membership belongs to", async ({ run, write, ok }) => {
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    write.mockResolvedValue(ok);
    await run();
    expect(revalidatePath).toHaveBeenCalledWith(detail);
  });
  it("restore revalidates the snapshot's contact's page", async () => {
    access.role = "staff";
    db.getContact.mockResolvedValue({ id: C });
    db.restoreMembership.mockResolvedValue("ok");
    await A.restoreMembershipAction("a1", snap());
    expect(revalidatePath).toHaveBeenCalledWith(detail);
  });
  // Final review minor 9: a rename once revalidated the literal route PATTERN, i.e. every contact page of
  // every account. It now revalidates this account's list only. The open page is refreshed by the card
  // itself (GroupsCard's onChanged runs router.refresh(), pinned in groups-card.wiring.test.ts), and every
  // other member's page is force-dynamic with no staleTimes override, so it renders fresh when opened.
  it("rename revalidates this account's list and never a route pattern across every account (mutation: put the pattern revalidate back -> FAILS)", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue({ id: G, kind: "business", name: "Acme", billingAddress: null });
    db.updateGroup.mockResolvedValue({ status: "ok", previous: { name: "Acme", billingAddress: null } });
    expect((await A.renameGroupAction("a1", G, "Acme Roofing")).ok).toBe(true);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/dashboard/accounts/a1/contacts"]]);
  });
});

/**
 * Spec §8: a refusal is logged. One line per explicit refusal: the action,
 * the account, the reason key and ids only, never a name (the groups and
 * contacts here are a client's customers).
 */
describe("every explicit refusal is logged, with ids and no names (spec §8; mutation: drop the log in the refusal helper -> FAILS)", () => {
  const cases = [
    { name: "createGroupAction", setup: () => db.getContact.mockResolvedValue(null), run: () => A.createGroupAction("a1", C, "household", "Garcia") },
    { name: "addToGroupAction", setup: () => db.getContact.mockResolvedValue(null), run: () => A.addToGroupAction("a1", C, G) },
    { name: "setRoleAction", setup: () => db.readMembership.mockResolvedValue(null), run: () => A.setRoleAction("a1", M, "Madre") },
    { name: "setBillingAction", setup: () => db.readMembership.mockResolvedValue(null), run: () => A.setBillingAction("a1", M, true) },
    { name: "makePrimaryAction", setup: () => db.readMembership.mockResolvedValue(null), run: () => A.makePrimaryAction("a1", M) },
    { name: "removeMembershipAction", setup: () => db.readMembership.mockResolvedValue(null), run: () => A.removeMembershipAction("a1", M) },
    { name: "restoreMembershipAction", setup: () => db.getContact.mockResolvedValue(null), run: () => A.restoreMembershipAction("a1", snap()) },
    { name: "renameGroupAction", setup: () => db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null }), run: () => A.renameGroupAction("a1", G, "Garcia Lopez") },
    { name: "setBillingAddressAction", setup: () => db.readGroup.mockResolvedValue(null), run: () => A.setBillingAddressAction("a1", G, "1 Main St") },
  ];
  it.each(cases)("$name", async ({ name, setup, run }) => {
    setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await run()).toEqual({ ok: false, error: "groups.refused" });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain(`${name}: account a1: groups.refused`);
    expect(line).not.toMatch(/Garcia|Madre|Main St/);
  });
  it("a bad id is refused and logged too, before any read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await A.makePrimaryAction("a1", "nope")).toEqual({ ok: false, error: "groups.refused" });
    expect(String(warn.mock.calls[0]?.[0])).toContain("makePrimaryAction: account a1: groups.refused");
  });
});
