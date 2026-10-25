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
// The chain answers as the table would: its eq and contains filters apply, its order applies, and
// with no order the rows come back as stored (oldest first), which is what an unordered read may do.
type EventRow = { id: number; account_id: string; type: string; actor_id: string; created_at: string; payload: Record<string, unknown> };
const events = { data: [] as EventRow[], error: null as null | { message: string } };
const chain = { select: vi.fn(), eq: vi.fn(), contains: vi.fn(), gte: vi.fn(), order: vi.fn(), limit: vi.fn() };
const SERVICE = { service: true, from: vi.fn() };
const query = { eqs: [] as [string, unknown][], contains: {} as Record<string, unknown>, orders: [] as [keyof EventRow, boolean][] };
function answer(n: number) {
  if (events.error) return { data: null, error: events.error };
  let rows = events.data.filter((r) => query.eqs.every(([c, v]) => r[c as keyof EventRow] === v)
    && Object.entries(query.contains).every(([k, v]) => r.payload[k] === v));
  // Stable sorts, last key first, give the ORDER BY's lexicographic order.
  for (const [col, ascending] of [...query.orders].reverse()) {
    rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
  }
  return { data: rows.slice(0, n), error: null };
}
const OWNER_ID = "user_owner";
/** A client_group.member_removed event for M (contact C, group G) in a1, by the caller unless told otherwise. */
const removal = (over: { id?: number; actor?: string; at?: string; was?: unknown } = {}): EventRow => ({
  id: over.id ?? 7, account_id: "a1", type: "client_group.member_removed", actor_id: over.actor ?? "user_1",
  created_at: over.at ?? "2026-10-12T10:00:00.000Z",
  payload: { memberId: M, contactId: C, groupId: G, ...(over.was === undefined ? {} : { wasPrimaryContact: over.was }) },
});

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
  query.eqs = []; query.contains = {}; query.orders = [];
  for (const k of ["select", "gte"] as const) chain[k].mockReturnValue(chain);
  chain.eq.mockImplementation((c: string, v: unknown) => { query.eqs.push([c, v]); return chain; });
  chain.contains.mockImplementation((_c: string, v: Record<string, unknown>) => { query.contains = v; return chain; });
  chain.order.mockImplementation((c: keyof EventRow, o: { ascending: boolean }) => { query.orders.push([c, o.ascending]); return chain; });
  chain.limit.mockImplementation(async (n: number) => answer(n));
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

describe("S-47e (spec 5.12.3): a shared number's holding record is never put in a household or a business (mutation: drop the holding check in any action -> its case FAILS)", () => {
  const HOLDING = { id: C, first_name: "Caller", holds_shared_number: true };
  it("create: refused before the service write, logged with the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.getContact.mockResolvedValue(HOLDING);
    db.createGroupWithMember.mockResolvedValue({ status: "ok", memberId: M, name: "Garcia", existed: false });
    expect(await A.createGroupAction("a1", C, "household", "Garcia")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.createGroupWithMember).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(`createGroupAction: account a1: groups.refused (shared number holding record): contact ${C}`);
    warn.mockRestore();
  });
  it("add: refused before the service write, even with a visible household", async () => {
    db.getContact.mockResolvedValue(HOLDING);
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    db.addContactToGroup.mockResolvedValue({ status: "ok", memberId: M });
    expect(await A.addToGroupAction("a1", C, G)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.addContactToGroup).not.toHaveBeenCalled();
  });
  it("restore: Staff's snapshot naming it is refused before the service write", async () => {
    access.role = "staff";
    db.getContact.mockResolvedValue(HOLDING);
    db.restoreMembership.mockResolvedValue("ok");
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: false, error: "groups.refused" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
  it("the control: a person (holds_shared_number false) is written", async () => {
    access.role = "staff";
    db.getContact.mockResolvedValue({ ...HOLDING, first_name: "Ana", holds_shared_number: false });
    db.createGroupWithMember.mockResolvedValue({ status: "ok", memberId: M, name: "Garcia", existed: false });
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    db.addContactToGroup.mockResolvedValue({ status: "ok", memberId: M });
    db.restoreMembership.mockResolvedValue("ok");
    expect(await A.createGroupAction("a1", C, "household", "Garcia")).toEqual({ ok: true, memberId: M, name: "Garcia", existed: false });
    expect(await A.addToGroupAction("a1", C, G)).toEqual({ ok: true, memberId: M });
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: true });
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
    events.data = [removal()];
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: true });
    expect(SERVICE.from).toHaveBeenCalledWith("events");
    expect(chain.eq).toHaveBeenCalledWith("account_id", "a1");
    expect(chain.eq).toHaveBeenCalledWith("type", "client_group.member_removed");
    // The newest removal by ANYONE decides (review fix): the actor is judged on that row, not filtered in.
    expect(chain.eq).not.toHaveBeenCalledWith("actor_id", expect.anything());
    expect(chain.contains).toHaveBeenCalledWith("payload", { memberId: M, contactId: C, groupId: G });
    expect(query.orders).toEqual([["created_at", false], ["id", false]]);
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", snap(), "user_1");
  });
  it("the removal must be within the last 24 hours: the lookup is bounded by created_at (final review minor 7; mutation: drop the .gte(created_at) bound -> FAILS)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
      db.getContact.mockResolvedValue({ id: C });
      db.restoreMembership.mockResolvedValue("ok");
      events.data = [removal({ at: "2026-10-11T11:00:00.000Z" })];
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("the database's not_found is logged with the ids, one line (spec §10; mutation: drop the log -> FAILS)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue(GARCIA);
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "not_found" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await A.setGroupPrimaryContactAction("a1", G, M);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe(`setGroupPrimaryContactAction: account a1: groups.failed (not_found): group ${G}, member ${M}`);
  });
  it("null clears, with no membership read (the agency, whatever its role field says)", async () => {
    access.isAgency = true;
    db.readGroup.mockResolvedValue(GARCIA);
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: M });
    expect(await A.setGroupPrimaryContactAction("a1", G, null)).toEqual({ ok: true, previous: M });
    expect(db.readMembership).not.toHaveBeenCalled();
    expect(db.setGroupPrimaryContact).toHaveBeenCalledWith(SERVICE, "a1", G, null, "user_1");
  });
  it("uppercase ids are the same group and member: proven, written and revalidated lowercase (review minor 2; mutation: drop the lowercasing -> FAILS)", async () => {
    access.role = "owner";
    const LG = "abcdef12-3333-4333-8333-33333333333a";
    const LM = "abcdef12-2222-4222-8222-22222222222b";
    db.readGroup.mockResolvedValue({ ...GARCIA, id: LG });
    db.readMembership.mockResolvedValue({ contactId: C, groupId: LG });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: null });
    expect(await A.setGroupPrimaryContactAction("a1", LG.toUpperCase(), LM.toUpperCase())).toEqual({ ok: true, previous: null });
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, "a1", LG);
    expect(db.readMembership).toHaveBeenCalledWith(REQUEST, "a1", LM);
    // setGroupPrimaryContact skips its event when previous === memberId: that compare needs the stored (lowercase) form.
    expect(db.setGroupPrimaryContact).toHaveBeenCalledWith(SERVICE, "a1", LG, LM, "user_1");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/groups/${LG}`);
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
    events.data = [removal()];
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never)).toEqual({ ok: true });
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: false }), "user_1");
  });
  it("only a literal true counts: the text 'true' in a payload is not the flag (mutation: read it by truthiness -> FAILS)", async () => {
    events.data = [removal({ was: "true" })];
    await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: false }), "user_1");
  });
  it("the removal event saying wasPrimaryContact restores the flag (mutation: always false -> FAILS)", async () => {
    events.data = [removal({ was: true })];
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: false } as never)).toEqual({ ok: true });
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: true }), "user_1");
  });
  it("the lookup selects the actor and the payload it judges by (mutation: select id only -> FAILS)", async () => {
    events.data = [removal()];
    await A.restoreMembershipAction("a1", snap());
    expect(chain.select).toHaveBeenCalledWith("id, actor_id, payload");
  });

  // Review fix (Important): restore puts the row back under its OLD id, so an older removal of the same
  // member is still a match. Only the NEWEST removal, by anyone, may vouch for an Undo and its flag.
  it("an older removal by the caller does not vouch once the Owner has removed the member since: refused, nothing written (mutation: drop the actor check on the newest event -> FAILS)", async () => {
    events.data = [
      removal({ id: 7, at: "2026-10-12T09:00:00.000Z", was: true }),
      removal({ id: 9, at: "2026-10-12T11:00:00.000Z", actor: OWNER_ID, was: false }),
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.restoreMembership).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("not the caller's removal");
  });
  it("a newer removal through the Business name (the Owner renames the business; setContactsBusiness records it) refuses the replay of the caller's older one (review fix 2; mutation: drop the actor check on the newest event -> FAILS; the emit itself is pinned in client-groups-guards.test.ts)", async () => {
    // The event setContactsBusiness now writes for the membership a rename deleted: the same type and
    // payload keys as removeMembership's, so the newest-removal lookup sees it.
    const viaBusinessName = removal({ id: 11, at: "2026-10-12T12:00:00.000Z", actor: OWNER_ID, was: false });
    events.data = [removal({ id: 7, at: "2026-10-12T09:00:00.000Z", was: true }), viaBusinessName];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.restoreMembership).not.toHaveBeenCalled();
    // Without that event the caller's older removal is the newest, and it vouches: the hole review fix 2 closed.
    events.data = [removal({ id: 7, at: "2026-10-12T09:00:00.000Z", was: true })];
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never)).toEqual({ ok: true });
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: true }), "user_1");
  });
  it("cleared, then removed again by the caller: the newest removal's flag (false) decides, not the older true (mutation: read the removals unordered -> FAILS)", async () => {
    events.data = [
      removal({ id: 7, at: "2026-10-12T09:00:00.000Z", was: true }),
      removal({ id: 9, at: "2026-10-12T11:00:00.000Z", was: false }),
    ];
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never)).toEqual({ ok: true });
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: false }), "user_1");
  });
  it("two removals in the same instant: the later-written one (higher id) decides (mutation: drop the id tiebreak -> FAILS)", async () => {
    // Stored caller-first, so a sort on created_at alone (stable) would leave the caller's row on top.
    events.data = [
      removal({ id: 7, at: "2026-10-12T11:00:00.000Z", was: true }),
      removal({ id: 9, at: "2026-10-12T11:00:00.000Z", actor: OWNER_ID }),
    ];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await A.restoreMembershipAction("a1", snap())).toEqual({ ok: false, error: "groups.refused" });
    expect(db.restoreMembership).not.toHaveBeenCalled();
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

/**
 * S-03 2a final review (case-variant replay): jsonb `@>` compares strings exactly, a uuid cast does not.
 * Every id from the browser is lowercased before it reaches a read, a write, an event or the lookup.
 */
describe("S-03 2a final review: ids from the browser are lowercased before any read, write or lookup", () => {
  const LC = "abcdef12-1111-4111-8111-11111111111c";
  const LM = "abcdef12-2222-4222-8222-22222222222b";
  const LG = "abcdef12-3333-4333-8333-33333333333a";
  const UP = { id: LM.toUpperCase(), account_id: "a1", client_group_id: LG.toUpperCase(), contact_id: LC.toUpperCase(),
    role: null, is_primary: false, is_billing: false, is_primary_contact: true, created_at: "x" };
  const lettered = (over: { id: number; actor?: string; at: string; was?: boolean; ids?: "upper" }): EventRow => ({
    id: over.id, account_id: "a1", type: "client_group.member_removed", actor_id: over.actor ?? "user_1", created_at: over.at,
    payload: over.ids === "upper"
      ? { memberId: LM.toUpperCase(), contactId: LC, groupId: LG, wasPrimaryContact: over.was ?? false }
      : { memberId: LM, contactId: LC, groupId: LG, wasPrimaryContact: over.was ?? false },
  });
  beforeEach(() => { db.getContact.mockResolvedValue({ id: LC }); db.restoreMembership.mockResolvedValue("ok"); });

  it("an UPPERCASE snapshot over the Owner's newer lowercase removal is refused (mutation: drop the snapshot's lowercasing -> FAILS)", async () => {
    // The caller's old removal, recorded by the old code with the browser's uppercase member id.
    events.data = [
      lettered({ id: 7, at: "2026-10-12T09:00:00.000Z", was: true, ids: "upper" }),
      lettered({ id: 9, at: "2026-10-12T11:00:00.000Z", actor: OWNER_ID }),
    ];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await A.restoreMembershipAction("a1", UP as never)).toEqual({ ok: false, error: "groups.refused" });
    expect(chain.contains).toHaveBeenCalledWith("payload", { memberId: LM, contactId: LC, groupId: LG });
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
  it("Staff's uppercase snapshot is proven and restored lowercase, and the pages revalidated lowercase", async () => {
    access.role = "staff";
    expect(await A.restoreMembershipAction("a1", UP as never)).toEqual({ ok: true });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", LC);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1",
      expect.objectContaining({ id: LM, contact_id: LC, client_group_id: LG }), "user_1");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/groups/${LG}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/contacts/${LC}`);
  });
  it.each([
    { name: "remove", run: () => A.removeMembershipAction("a1", LM.toUpperCase()), write: db.removeMembership,
      ok: { status: "ok", removed: { ...UP, id: LM } }, args: [SERVICE, "a1", LM, "user_1"] },
    { name: "role", run: () => A.setRoleAction("a1", LM.toUpperCase(), "Madre"), write: db.updateMembership,
      ok: { status: "ok", previous: { role: null, isBilling: false } }, args: [SERVICE, "a1", LM, { role: "Madre" }, "user_1"] },
    { name: "pays", run: () => A.setBillingAction("a1", LM.toUpperCase(), true), write: db.updateMembership,
      ok: { status: "ok", previous: { role: null, isBilling: false } }, args: [SERVICE, "a1", LM, { isBilling: true }, "user_1"] },
    { name: "main", run: () => A.makePrimaryAction("a1", LM.toUpperCase()), write: db.setPrimaryMembership,
      ok: { status: "ok", previous: null }, args: [SERVICE, "a1", LM, "user_1"] },
  ])("$name: an uppercase member id is proven and written lowercase (mutation: drop the member id's lowercasing -> FAILS)", async ({ run, write, ok, args }) => {
    db.readMembership.mockResolvedValue({ contactId: LC, groupId: LG });
    write.mockResolvedValue(ok);
    expect((await run()).ok).toBe(true);
    expect(db.readMembership).toHaveBeenCalledWith(REQUEST, "a1", LM);
    expect(write).toHaveBeenCalledWith(...args);
  });
  it("create, add, rename and billing address take uppercase contact and group ids lowercase (mutation: drop their lowercasing -> FAILS)", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue({ id: LG, kind: "business", name: "Acme", billingAddress: null });
    db.createGroupWithMember.mockResolvedValue({ status: "ok", groupId: LG, memberId: LM, existed: false, name: "Acme" });
    db.addContactToGroup.mockResolvedValue({ status: "ok", memberId: LM });
    db.updateGroup.mockResolvedValue({ status: "ok", previous: { name: "Acme", billingAddress: null } });
    expect((await A.createGroupAction("a1", LC.toUpperCase(), "business", "Acme")).ok).toBe(true);
    expect(db.createGroupWithMember).toHaveBeenCalledWith(SERVICE, "a1", LC, "business", "Acme", null, "user_1");
    expect((await A.addToGroupAction("a1", LC.toUpperCase(), LG.toUpperCase())).ok).toBe(true);
    expect(db.addContactToGroup).toHaveBeenCalledWith(SERVICE, "a1", LC, LG, null, "user_1");
    expect((await A.renameGroupAction("a1", LG.toUpperCase(), "Acme Roofing")).ok).toBe(true);
    expect((await A.setBillingAddressAction("a1", LG.toUpperCase(), "1 Main St")).ok).toBe(true);
    expect(db.updateGroup.mock.calls.map((c) => c[2])).toEqual([LG, LG]);
    expect(db.readGroup.mock.calls.every((c) => c[2] === LG)).toBe(true);
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
