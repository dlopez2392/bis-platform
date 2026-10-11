import { describe, it, expect, vi, beforeEach } from "vitest";

const access = { userId: "user_1", isAgency: false, role: "technician" as string | null, canManage: false };
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => access) }));
const REQUEST = { request: true };
const SERVICE = { service: true };
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => REQUEST) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const db = {
  serviceDb: vi.fn(() => SERVICE),
  getContact: vi.fn(), readMembership: vi.fn(), readGroup: vi.fn(),
  searchGroups: vi.fn(async () => []), createGroupWithMember: vi.fn(), addContactToGroup: vi.fn(),
  updateMembership: vi.fn(), setPrimaryMembership: vi.fn(), removeMembership: vi.fn(), restoreMembership: vi.fn(),
  updateGroup: vi.fn(), GROUP_NAME_MAX: 120, GROUP_ROLE_MAX: 60, BILLING_ADDRESS_MAX: 300,
};
vi.mock("@bis/db", () => db);

const A = await import("./groups-actions");
const C = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const G = "33333333-3333-4333-8333-333333333333";

beforeEach(() => { vi.clearAllMocks(); access.role = "technician"; access.isAgency = false; });

describe("every write proves its target through the request client first (mutation: skip the proof in any action -> its case FAILS)", () => {
  it("create: an unseen contact never reaches the service write", async () => {
    db.getContact.mockResolvedValue(null);
    expect(await A.createGroupAction("a1", C, "household", "Garcia")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.createGroupWithMember).not.toHaveBeenCalled();
  });
  it("add, role, pays, main, remove: an unseen membership or contact never reaches the service write", async () => {
    db.getContact.mockResolvedValue(null);
    db.readMembership.mockResolvedValue(null);
    expect((await A.addToGroupAction("a1", C, G)).ok).toBe(false);
    expect((await A.setRoleAction("a1", M, "Madre")).ok).toBe(false);
    expect((await A.setBillingAction("a1", M, true)).ok).toBe(false);
    expect((await A.makePrimaryAction("a1", M)).ok).toBe(false);
    expect((await A.removeMembershipAction("a1", M)).ok).toBe(false);
    for (const f of [db.addContactToGroup, db.updateMembership, db.setPrimaryMembership, db.removeMembership]) expect(f).not.toHaveBeenCalled();
  });
  it("restore: the snapshot's contact must be one the caller can see", async () => {
    db.getContact.mockResolvedValue(null);
    const snap = { id: M, account_id: "a1", client_group_id: G, contact_id: C, role: null, is_primary: false, is_billing: false, created_at: "x" };
    expect((await A.restoreMembershipAction("a1", snap)).ok).toBe(false);
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
  it("restore: a snapshot naming another account is refused, even for a contact the caller can see (mutation: drop the account_id check -> FAILS)", async () => {
    db.getContact.mockResolvedValue({ id: C });
    db.restoreMembership.mockResolvedValue("ok");
    const snap = { id: M, account_id: "a2", client_group_id: G, contact_id: C, role: null, is_primary: false, is_billing: false, created_at: "x" };
    expect(await A.restoreMembershipAction("a1", snap)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
  it("a proven write goes through the SERVICE client", async () => {
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setPrimaryMembership.mockResolvedValue({ status: "ok", previous: null });
    expect(await A.makePrimaryAction("a1", M)).toEqual({ ok: true, previous: null });
    expect(db.setPrimaryMembership).toHaveBeenCalledWith(SERVICE, "a1", M, "user_1");
  });
});

describe("A6: rename and billing address are Owner, Staff and agency only", () => {
  it("a Technician is refused even for a group they can see", async () => {
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    expect(await A.renameGroupAction("a1", G, "García")).toEqual({ ok: false, error: "groups.refused" });
    expect(await A.setBillingAddressAction("a1", G, "1 Main St")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.updateGroup).not.toHaveBeenCalled();
  });
  it("Staff renames; a taken business name reads as nameTaken", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue({ id: G, kind: "business", name: "Acme", billingAddress: null });
    db.updateGroup.mockResolvedValue({ status: "name_taken" });
    expect(await A.renameGroupAction("a1", G, "Beta")).toEqual({ ok: false, error: "groups.nameTaken" });
  });
});

describe("input shape", () => {
  it("refuses a non-uuid id and an over-long name or role without touching the database", async () => {
    expect((await A.makePrimaryAction("a1", "nope")).ok).toBe(false);
    expect(await A.createGroupAction("a1", C, "household", "x".repeat(121))).toEqual({ ok: false, error: "groups.tooLong" });
    expect(await A.setRoleAction("a1", M, "x".repeat(61))).toEqual({ ok: false, error: "groups.tooLong" });
    expect(db.readMembership).not.toHaveBeenCalled();
  });
});
