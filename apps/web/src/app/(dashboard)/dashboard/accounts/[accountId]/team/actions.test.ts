import { describe, it, expect, vi, beforeEach } from "vitest";

// revalidatePath throws outside a request ("static generation store missing").
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

const guard = vi.hoisted(() => ({ requireAccountOwner: vi.fn() }));
vi.mock("@/lib/auth", () => guard);

// serviceDb(): the account read (`accounts`, select("*")). `from` is a spy so
// a guard test can prove the database was never reached.
const rows = vi.hoisted(() => ({
  account: { id: "acct", clerk_org_id: "org_1", client_access_enabled: true } as Record<string, unknown> | null,
}));
const from = vi.hoisted(() => vi.fn());
const selected = vi.hoisted(() => [] as unknown[]);
const db = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  listAccountTeam: vi.fn(), setAccountMemberRole: vi.fn(), setMemberLanguage: vi.fn(),
  removeAccountMember: vi.fn(), addAccountMember: vi.fn(), deleteAccountMembership: vi.fn(),
  releaseMemberAssignments: vi.fn(), reassignReleased: vi.fn(), releaseTasksOffCustomers: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

const clerk = vi.hoisted(() => ({
  teamCapacity: vi.fn(), createTeamInvitation: vi.fn(), revokeTeamInvitation: vi.fn(),
  removeFromOrganization: vi.fn(), restoreToOrganization: vi.fn(), setOrganizationRole: vi.fn(), reassertClerkRole: vi.fn(),
}));
// clerkRefused is the real one (a pure function of the result): the role
// action's rollback turns on it, so a fake here would test the fake.
vi.mock("@/lib/team/clerk-team", async (importOriginal) => ({
  clerkRefused: (await importOriginal<typeof import("@/lib/team/clerk-team")>()).clerkRefused, ...clerk,
}));

const log = vi.hoisted(() => ({ recordRemoval: vi.fn(), latestRemoval: vi.fn() }));
vi.mock("@/lib/team/removal-log", () => log);

import { UNDO_WINDOW_MS } from "@/lib/team/team-view";
import {
  inviteTeamMemberAction, setTeamRoleAction, setTeamLanguageAction, removeTeamMemberAction,
  undoRemoveTeamMemberAction, revokeTeamInvitationAction, undoRevokeTeamInvitationAction,
} from "./actions";

const ACCT = "acct";
const OWNER_A = { userId: "11111111-1111-4111-8111-111111111111", clerkUserId: "user_A", email: "a@x.com", name: "A", role: "owner" as const, language: "en" as const };
const OWNER_B = { userId: "22222222-2222-4222-8222-222222222222", clerkUserId: "user_B", email: "b@x.com", name: "B", role: "owner" as const, language: null };
const STAFF_C = { userId: "33333333-3333-4333-8333-333333333333", clerkUserId: "user_C", email: "c@x.com", name: "C", role: "staff" as const, language: "es" as const };
/** What releaseMemberAssignments hands back by default: the ids a removal took off this person. */
const RELEASED = { contacts: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"], tasks: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] };

function fakeDb() {
  from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.select = (cols: unknown) => { if (table === "accounts") selected.push(cols); return chain; };
    chain.maybeSingle = async () => ({ data: table === "accounts" ? rows.account : null, error: null });
    return chain;
  });
  return { from };
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** A removal event `agoMs` old, in the shape latestRemoval returns. */
function removal(member: { userId: string; clerkUserId: string; role: "owner" | "staff" | "technician"; language: "en" | "es" | null }, agoMs = 10_000, released = { contacts: [] as string[], tasks: [] as string[] }) {
  return { userId: member.userId, clerkUserId: member.clerkUserId, role: member.role, language: member.language, released, removedAt: new Date(Date.now() - agoMs).toISOString() };
}

const allDataMocks = () => [from, ...Object.values(db).filter((f) => f !== db.serviceDb), ...Object.values(clerk), ...Object.values(log)];
const logged = () => vi.mocked(console.error).mock.calls.map(String).join("\n");
const order = (f: { mock: { invocationCallOrder: number[] } }, i = 0) => f.mock.invocationCallOrder[i] ?? Number.NaN;

beforeEach(() => {
  vi.resetAllMocks(); // reset, not clear: a leftover mock*Once queue must not leak into the next test
  vi.spyOn(console, "error").mockImplementation(() => {});
  rows.account = { id: ACCT, clerk_org_id: "org_1", client_access_enabled: true };
  guard.requireAccountOwner.mockResolvedValue({ userId: "user_A", isAgency: false });
  db.serviceDb.mockImplementation(fakeDb);
  db.listAccountTeam.mockResolvedValue([OWNER_A, OWNER_B, STAFF_C]);
  db.setAccountMemberRole.mockResolvedValue("ok");
  db.setMemberLanguage.mockResolvedValue("ok");
  db.removeAccountMember.mockResolvedValue("ok");
  db.addAccountMember.mockResolvedValue("created");
  db.deleteAccountMembership.mockResolvedValue(undefined);
  db.releaseMemberAssignments.mockResolvedValue(RELEASED);
  db.reassignReleased.mockResolvedValue(undefined);
  db.releaseTasksOffCustomers.mockResolvedValue([]);
  selected.length = 0;
  clerk.teamCapacity.mockResolvedValue({ maxAllowed: 5, members: 3, pending: 0 });
  clerk.createTeamInvitation.mockResolvedValue({ ok: true });
  clerk.revokeTeamInvitation.mockResolvedValue({ ok: true, invite: { id: "orginv_1", email: "d@x.com", role: "owner", language: "es" } });
  clerk.removeFromOrganization.mockResolvedValue({ ok: true });
  clerk.restoreToOrganization.mockResolvedValue({ ok: true });
  clerk.setOrganizationRole.mockResolvedValue({ ok: true });
  clerk.reassertClerkRole.mockResolvedValue({ ok: true, changed: false });
  log.recordRemoval.mockResolvedValue(undefined);
  log.latestRemoval.mockResolvedValue(removal(STAFF_C));
});

describe("Staff calling an Owner action is redirected before anything is read or written", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["inviteTeamMemberAction", () => inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))],
    ["setTeamRoleAction", () => setTeamRoleAction(ACCT, STAFF_C.userId, "owner")],
    ["setTeamLanguageAction", () => setTeamLanguageAction(ACCT, STAFF_C.userId, "en")],
    ["removeTeamMemberAction", () => removeTeamMemberAction(ACCT, STAFF_C.userId)],
    ["undoRemoveTeamMemberAction", () => undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)],
    ["revokeTeamInvitationAction", () => revokeTeamInvitationAction(ACCT, "orginv_1")],
    ["undoRevokeTeamInvitationAction", () => undoRevokeTeamInvitationAction(ACCT, "d@x.com", "staff", "en")],
  ];
  it.each(cases)("%s: requireAccountOwner's redirect stops it cold (mutation: delete the guard from this action -> FAILS)", async (_name, call) => {
    guard.requireAccountOwner.mockRejectedValue(Object.assign(new Error("NEXT_REDIRECT"), { url: "/dashboard/accounts/acct/dashboard" }));
    await expect(call()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.requireAccountOwner).toHaveBeenCalledWith(ACCT);
    for (const f of allDataMocks()) expect(f).not.toHaveBeenCalled();
  });
});

describe("the account read names its columns (review M3)", () => {
  it("reads clerk_org_id, client_access_enabled and language, never * (mutation: select('*') -> FAILS)", async () => {
    await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }));
    expect(selected).toEqual(["clerk_org_id, client_access_enabled, language"]);
  });
});

describe("inviteTeamMemberAction", () => {
  it("invites as Staff in English by default, with the caller as inviter (mutation: default role owner -> FAILS)", async () => {
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: true });
    expect(clerk.createTeamInvitation).toHaveBeenCalledWith({ orgId: "org_1", email: "d@x.com", role: "staff", language: "en", inviterUserId: "user_A" });
  });
  it("carries the chosen role and language", async () => {
    await inviteTeamMemberAction(ACCT, form({ email: "d@x.com", role: "owner", language: "es" }));
    expect(clerk.createTeamInvitation).toHaveBeenCalledWith(expect.objectContaining({ role: "owner", language: "es" }));
  });
  it("defaults the language to the account's own when it has one (mutation: ignore the account -> FAILS)", async () => {
    rows.account = { ...rows.account, language: "es" };
    await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }));
    expect(clerk.createTeamInvitation).toHaveBeenCalledWith(expect.objectContaining({ language: "es" }));
  });
  it("refuses a bad address or an unknown role before Clerk", async () => {
    expect(await inviteTeamMemberAction(ACCT, form({ email: "not-an-address" }))).toEqual({ ok: false, error: "team.invite.badEmail" });
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com", role: "admin" }))).toEqual({ ok: false, error: "team.invite.failed" });
    expect(clerk.createTeamInvitation).not.toHaveBeenCalled();
  });
  it("refuses while client access is off, before Clerk (mutation: skip the check -> FAILS)", async () => {
    rows.account = { ...rows.account, client_access_enabled: false };
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: false, error: "team.accessOff" });
    expect(clerk.createTeamInvitation).not.toHaveBeenCalled();
  });
  it("Cap reached: a full team is refused before Clerk is asked to invite (mutation: skip the cap check -> FAILS)", async () => {
    clerk.teamCapacity.mockResolvedValue({ maxAllowed: 2, members: 2, pending: 0 });
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: false, error: "team.full" });
    expect(clerk.createTeamInvitation).not.toHaveBeenCalled();
  });
  it("pending invitations count against the cap", async () => {
    clerk.teamCapacity.mockResolvedValue({ maxAllowed: 3, members: 2, pending: 1 });
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: false, error: "team.full" });
  });
  it("an unreadable cap still lets Clerk decide; its quota error is team.full", async () => {
    clerk.teamCapacity.mockRejectedValue(new Error("teamCapacity: down"));
    clerk.createTeamInvitation.mockResolvedValue({ ok: false, code: "organization_membership_quota_exceeded" });
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: false, error: "team.full" });
  });
  it("maps Clerk's expected refusals to their codes (mutation: map everything to failed -> FAILS)", async () => {
    clerk.createTeamInvitation.mockResolvedValue({ ok: false, code: "duplicate_record" });
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: false, error: "team.invite.alreadyInvited" });
    clerk.createTeamInvitation.mockResolvedValue({ ok: false, code: "already_a_member_in_organization" });
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: false, error: "team.invite.alreadyMember" });
    clerk.createTeamInvitation.mockResolvedValue({ ok: false, code: null });
    expect(await inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))).toEqual({ ok: false, error: "team.invite.failed" });
  });
});

describe("setTeamRoleAction: demotion (Owner to Staff) demotes in Clerk FIRST", () => {
  it("Clerk is demoted to Staff before the BIS write, and the previous role comes back for the undo (mutation: BIS first -> FAILS)", async () => {
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: true, previous: "owner" });
    expect(clerk.setOrganizationRole).toHaveBeenCalledWith("org_1", "user_B", "staff");
    expect(db.setAccountMemberRole).toHaveBeenCalledWith(expect.anything(), ACCT, OWNER_B.userId, "staff");
    expect(order(clerk.setOrganizationRole)).toBeLessThan(order(db.setAccountMemberRole));
  });
  it("Clerk refusing the demotion leaves BIS untouched (mutation: write BIS anyway -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValue({ ok: false, code: "internal" });
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: false, error: "team.role.failed" });
    expect(db.setAccountMemberRole).not.toHaveBeenCalled();
  });
  it("Last Owner: refused, and Clerk ends at the role it started with, org:admin (mutation: no Clerk restore -> FAILS)", async () => {
    db.setAccountMemberRole.mockResolvedValue("last_owner");
    expect(await setTeamRoleAction(ACCT, OWNER_A.userId, "staff")).toEqual({ ok: false, error: "team.lastOwner" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_A", "staff"], ["org_1", "user_A", "owner"]]);
  });
  it("Last Owner and the Clerk restore fails: BIS Owner beside Clerk member is the safe side; logged by id, never by address", async () => {
    db.setAccountMemberRole.mockResolvedValue("last_owner");
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, code: "internal" });
    expect(await setTeamRoleAction(ACCT, OWNER_A.userId, "staff")).toEqual({ ok: false, error: "team.lastOwner" });
    expect(logged()).toContain(OWNER_A.userId);
    expect(logged()).toContain(ACCT);
    expect(logged()).not.toContain("a@x.com");
  });
  it("a BIS not_found or throw after the Clerk demotion also puts Clerk back", async () => {
    db.setAccountMemberRole.mockResolvedValue("not_found");
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: false, error: "team.changed" });
    expect(clerk.setOrganizationRole).toHaveBeenLastCalledWith("org_1", "user_B", "owner");
    clerk.setOrganizationRole.mockClear();
    db.setAccountMemberRole.mockRejectedValue(new Error("setAccountMemberRole failed: down"));
    await expect(setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).rejects.toThrow();
    expect(clerk.setOrganizationRole).toHaveBeenLastCalledWith("org_1", "user_B", "owner");
  });
});

describe("setTeamRoleAction: promotion (Staff to Owner) writes BIS first", () => {
  it("BIS first, then Clerk org:admin; previous is Staff, which the undo sends back (mutation: skip the Clerk update -> FAILS)", async () => {
    db.listAccountTeam.mockResolvedValueOnce([OWNER_A, OWNER_B, STAFF_C]).mockResolvedValue([OWNER_A, OWNER_B, { ...STAFF_C, role: "owner" }]);
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: true, previous: "staff" });
    expect(clerk.setOrganizationRole).toHaveBeenCalledWith("org_1", "user_C", "owner");
    expect(order(db.setAccountMemberRole)).toBeLessThan(order(clerk.setOrganizationRole));
  });
  it("BIS not_found: Clerk is never touched", async () => {
    db.setAccountMemberRole.mockResolvedValue("not_found");
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.changed" });
    expect(clerk.setOrganizationRole).not.toHaveBeenCalled();
  });
  it("Clerk refuses with a 4xx: Clerk is set back to member FIRST, then BIS rolls back to Staff (mutations: roll back to owner, or roll BIS back before Clerk -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "form_param_value_invalid", status: 422 }).mockResolvedValueOnce({ ok: true });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_C", "owner"], ["org_1", "user_C", "staff"]]);
    expect(db.setAccountMemberRole.mock.calls).toEqual([
      [expect.anything(), ACCT, STAFF_C.userId, "owner"], [expect.anything(), ACCT, STAFF_C.userId, "staff"]]);
    expect(order(clerk.setOrganizationRole, 1)).toBeLessThan(order(db.setAccountMemberRole, 1));
  });
  it("Clerk refuses and the set-back also fails: BIS is LEFT at Owner (the safe side) and logged (mutation: roll BIS back anyway -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValue({ ok: false, code: "form_param_value_invalid", status: 422 });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(db.setAccountMemberRole).toHaveBeenCalledTimes(1);
    expect(logged()).toContain(STAFF_C.userId);
  });
  it("a Clerk TIMEOUT may still land later, so BIS is left at Owner even when the set-back answered (mutation: treat timeout like a refusal -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "timeout", status: null }).mockResolvedValueOnce({ ok: true });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(db.setAccountMemberRole).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["502", { ok: false, code: "internal", status: 502 }],
    ["504", { ok: false, code: null, status: 504 }],
    ["a network error", { ok: false, code: null, status: null }],
  ])("Clerk %s on promotion may have landed: BIS is LEFT at Owner, logged by id, revalidated, team.role.failed (review I1; mutation: roll back on any failure -> FAILS)", async (_n, failure) => {
    clerk.setOrganizationRole.mockResolvedValueOnce(failure).mockResolvedValue({ ok: true });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(db.setAccountMemberRole.mock.calls).toEqual([[expect.anything(), ACCT, STAFF_C.userId, "owner"]]);
    expect(logged()).toContain(STAFF_C.userId);
    expect(logged()).toContain(ACCT);
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/${ACCT}/team`);
  });
  it("a BIS rollback that throws is logged by id and still reported as a failure", async () => {
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "form_param_value_invalid", status: 422 }).mockResolvedValueOnce({ ok: true });
    db.setAccountMemberRole.mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("down"));
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(logged()).toContain(STAFF_C.userId);
    expect(logged()).not.toContain("c@x.com");
  });
});

describe("setTeamRoleAction: a concurrent change can never leave BIS Staff beside Clerk org:admin (review I2)", () => {
  it("after the promotion's Clerk write, BIS is re-read; no longer Owner means Clerk goes back to org:member (mutation: skip the re-read -> FAILS)", async () => {
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.changed" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_C", "owner"], ["org_1", "user_C", "staff"]]);
  });
  it("a re-read that fails also sends Clerk back to org:member, the safe side, with the least privileged bis_role (mutation: trust the promotion when unread, or set back to staff -> FAILS)", async () => {
    db.listAccountTeam.mockResolvedValueOnce([OWNER_A, OWNER_B, STAFF_C]).mockRejectedValue(new Error("listAccountTeam failed: down"));
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(clerk.setOrganizationRole).toHaveBeenLastCalledWith("org_1", "user_C", "technician");
    expect(logged()).toContain(STAFF_C.userId);
  });
  it("a promotion BIS still holds after the Clerk write is a success with no set-back", async () => {
    db.listAccountTeam.mockResolvedValueOnce([OWNER_A, OWNER_B, STAFF_C]).mockResolvedValue([OWNER_A, OWNER_B, { ...STAFF_C, role: "owner" }]);
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: true, previous: "staff" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_C", "owner"]]);
  });
  it("after the demotion's BIS write, Clerk is set to org:member AGAIN (mutation: drop the repeat -> FAILS)", async () => {
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: true, previous: "owner" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_B", "staff"], ["org_1", "user_B", "staff"]]);
    expect(order(db.setAccountMemberRole)).toBeLessThan(order(clerk.setOrganizationRole, 1));
  });

  /** One person's BIS and Clerk roles, shared by two Owners acting at once. */
  type Role = "owner" | "staff";
  type Hook = { on: "bis" | "clerk"; role: Role; run: () => Promise<unknown> };
  function world(start: Role) {
    const state = { bis: start, clerk: start };
    let before: Hook | null = null;
    const fire = async (on: "bis" | "clerk", role: Role) => {
      const b = before;
      if (b && b.on === on && b.role === role) { before = null; await b.run(); }
    };
    db.listAccountTeam.mockImplementation(async () => [OWNER_A, OWNER_B, { ...STAFF_C, role: state.bis }]);
    db.setAccountMemberRole.mockImplementation(async (_db: unknown, _a: string, _u: string, role: Role) => { await fire("bis", role); state.bis = role; return "ok"; });
    clerk.setOrganizationRole.mockImplementation(async (_o: string, _u: string, role: Role) => { await fire("clerk", role); state.clerk = role; return { ok: true }; });
    return { state, interleave: (h: Hook) => { before = h; } };
  }

  it("A promotes while B demotes, and A's Clerk org:admin write lands LAST: ends Staff and org:member (mutation: skip the promotion's re-read -> FAILS)", async () => {
    const w = world("staff");
    w.interleave({ on: "clerk", role: "owner", run: () => setTeamRoleAction(ACCT, STAFF_C.userId, "staff") });
    await setTeamRoleAction(ACCT, STAFF_C.userId, "owner");
    expect(w.state).toEqual({ bis: "staff", clerk: "staff" });
  });
  it("B demotes while A promotes, and A's whole promotion lands between B's Clerk write and B's BIS write: ends Staff and org:member (mutation: drop the demotion's repeat -> FAILS)", async () => {
    const w = world("owner");
    w.interleave({ on: "bis", role: "staff", run: () => setTeamRoleAction(ACCT, STAFF_C.userId, "owner") });
    await setTeamRoleAction(ACCT, STAFF_C.userId, "staff");
    expect(w.state).toEqual({ bis: "staff", clerk: "staff" });
  });
});

describe("setTeamRoleAction: input", () => {
  it("someone no longer on the team, or a malformed id or role, is team.changed and touches nothing", async () => {
    expect(await setTeamRoleAction(ACCT, "44444444-4444-4444-8444-444444444444", "staff")).toEqual({ ok: false, error: "team.changed" });
    expect(await setTeamRoleAction(ACCT, "user_B", "staff")).toEqual({ ok: false, error: "team.changed" });
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "admin" as never)).toEqual({ ok: false, error: "team.changed" });
    expect(db.setAccountMemberRole).not.toHaveBeenCalled();
    expect(clerk.setOrganizationRole).not.toHaveBeenCalled();
  });
});

describe("setTeamLanguageAction", () => {
  it("sets the language and returns the previous one, null included (mutation: return the new one as previous -> FAILS)", async () => {
    expect(await setTeamLanguageAction(ACCT, STAFF_C.userId, "en")).toEqual({ ok: true, previous: "es" });
    expect(db.setMemberLanguage).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId, "en");
    expect(await setTeamLanguageAction(ACCT, OWNER_B.userId, "es")).toEqual({ ok: true, previous: null });
  });
  it("not_found is team.changed; an unknown language is refused before the write", async () => {
    db.setMemberLanguage.mockResolvedValue("not_found");
    expect(await setTeamLanguageAction(ACCT, STAFF_C.userId, null)).toEqual({ ok: false, error: "team.changed" });
    db.setMemberLanguage.mockClear();
    expect(await setTeamLanguageAction(ACCT, STAFF_C.userId, "fr" as never)).toEqual({ ok: false, error: "team.changed" });
    expect(db.setMemberLanguage).not.toHaveBeenCalled();
  });
});

describe("removeTeamMemberAction", () => {
  it("removes in BIS (the guard), then from the Clerk org, then records the removal; the undo carries only the user id (mutation: skip the Clerk removal -> FAILS)", async () => {
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true, undo: { userId: STAFF_C.userId } });
    expect(db.removeAccountMember).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId);
    expect(clerk.removeFromOrganization).toHaveBeenCalledWith("org_1", "user_C");
    expect(log.recordRemoval).toHaveBeenCalledWith(expect.anything(), ACCT, "user_A",
      { userId: STAFF_C.userId, clerkUserId: "user_C", role: "staff", language: "es", released: RELEASED });
    expect(order(clerk.removeFromOrganization)).toBeLessThan(order(log.recordRemoval));
  });
  it("Last Owner: refused; the Clerk membership is never removed and nothing is recorded (mutation: call Clerk first -> FAILS)", async () => {
    db.removeAccountMember.mockResolvedValue("last_owner");
    expect(await removeTeamMemberAction(ACCT, OWNER_A.userId)).toEqual({ ok: false, error: "team.lastOwner" });
    expect(clerk.removeFromOrganization).not.toHaveBeenCalled();
    expect(log.recordRemoval).not.toHaveBeenCalled();
  });
  it("Remove rollback: Clerk failing re-adds an Owner as Owner (mutation: re-add as staff -> FAILS)", async () => {
    clerk.removeFromOrganization.mockResolvedValue({ ok: false, code: "internal" });
    expect(await removeTeamMemberAction(ACCT, OWNER_B.userId)).toEqual({ ok: false, error: "team.remove.failed" });
    expect(db.addAccountMember).toHaveBeenCalledWith(expect.anything(), { accountId: ACCT, userId: OWNER_B.userId, role: "owner" });
    expect(log.recordRemoval).not.toHaveBeenCalled();
  });
  it("Remove rollback: Clerk failing re-adds Staff as Staff (mutation: re-add as owner -> FAILS)", async () => {
    clerk.removeFromOrganization.mockResolvedValue({ ok: false, code: "internal" });
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: false, error: "team.remove.failed" });
    expect(db.addAccountMember).toHaveBeenCalledWith(expect.anything(), { accountId: ACCT, userId: STAFF_C.userId, role: "staff" });
  });
  it("a rollback that throws is caught and logged by id (mutation: let it throw -> FAILS)", async () => {
    clerk.removeFromOrganization.mockResolvedValue({ ok: false, code: "internal" });
    db.addAccountMember.mockRejectedValue(new Error("down"));
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: false, error: "team.remove.failed" });
    expect(logged()).toContain(STAFF_C.userId);
    expect(logged()).not.toContain("c@x.com");
  });
  it("after Clerk's delete and the record, the BIS membership is swept AGAIN, removing a row a concurrent request recreated (review I3; mutation: drop the sweep -> FAILS)", async () => {
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true, undo: { userId: STAFF_C.userId } });
    expect(db.deleteAccountMembership).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId);
    expect(order(clerk.removeFromOrganization)).toBeLessThan(order(db.deleteAccountMembership));
    expect(order(log.recordRemoval)).toBeLessThan(order(db.deleteAccountMembership));
  });
  it("the sweep runs even when the record failed, and a sweep that throws is logged by id, never thrown (mutation: let it throw -> FAILS)", async () => {
    log.recordRemoval.mockRejectedValue(new Error("event emit failed: down"));
    db.deleteAccountMembership.mockRejectedValue(new Error("deleteAccountMembership failed: down"));
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true });
    expect(db.deleteAccountMembership).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId);
    expect(logged()).toMatch(new RegExp(`sweep[^\\n]*${STAFF_C.userId}`));
  });
  it("a Clerk failure re-adds the row and never sweeps it (mutation: sweep before checking Clerk -> FAILS)", async () => {
    clerk.removeFromOrganization.mockResolvedValue({ ok: false, code: "internal", status: 500 });
    await removeTeamMemberAction(ACCT, STAFF_C.userId);
    expect(db.deleteAccountMembership).not.toHaveBeenCalled();
  });
  it("the removal stands when recording it fails, but no undo is offered", async () => {
    log.recordRemoval.mockRejectedValue(new Error("event emit failed: down"));
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true });
    expect(logged()).toContain(STAFF_C.userId);
  });
});

describe("undoRemoveTeamMemberAction: role, language and Clerk id come from the removal event, never the browser", () => {
  it("reads the removal for this account and person (mutation: read another person's -> FAILS)", async () => {
    await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId);
    expect(log.latestRemoval).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId);
  });
  it("a person never removed from this account is refused BEFORE Clerk is called (mutation: skip the event check -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(null);
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(clerk.restoreToOrganization).not.toHaveBeenCalled();
    expect(db.addAccountMember).not.toHaveBeenCalled();
  });
  it("an event older than the undo window is refused before Clerk (mutation: drop the window check -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(STAFF_C, UNDO_WINDOW_MS + 5_000));
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: false, error: "team.undo.expired" });
    expect(clerk.restoreToOrganization).not.toHaveBeenCalled();
  });
  it("a Staff removal undone comes back Staff, in Clerk and in BIS, with the event's language (mutations: restore or re-add as owner -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(STAFF_C));
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true });
    expect(clerk.restoreToOrganization).toHaveBeenCalledWith("org_1", "user_C", "staff");
    expect(db.addAccountMember).toHaveBeenCalledWith(expect.anything(), { accountId: ACCT, userId: STAFF_C.userId, role: "staff" });
    expect(db.setMemberLanguage).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId, "es");
    expect(order(clerk.restoreToOrganization)).toBeLessThan(order(db.addAccountMember));
  });
  it("an Owner removal undone comes back Owner (mutation: always staff -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(OWNER_B));
    expect(await undoRemoveTeamMemberAction(ACCT, OWNER_B.userId)).toEqual({ ok: true });
    expect(clerk.restoreToOrganization).toHaveBeenCalledWith("org_1", "user_B", "owner");
    expect(db.addAccountMember).toHaveBeenCalledWith(expect.anything(), { accountId: ACCT, userId: OWNER_B.userId, role: "owner" });
  });
  it("a row that already existed (the webhook got there first) is set to the event's role explicitly (mutation: skip the role set -> FAILS)", async () => {
    db.addAccountMember.mockResolvedValue("existed");
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true });
    expect(db.setAccountMemberRole).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId, "staff");
  });
  it("a double-clicked undo: Clerk says already a member and BIS already matches, so ok (mutation: treat it as a failure -> FAILS)", async () => {
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "already_a_member_in_organization" });
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true });
  });
  it("already a member in Clerk but BIS disagrees is a failure, not a silent ok", async () => {
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "already_a_member_in_organization" });
    db.listAccountTeam.mockResolvedValue([OWNER_A, OWNER_B]);
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: false, error: "team.undo.failed" });
  });
  it("any other Clerk refusal leaves BIS untouched", async () => {
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "internal" });
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(db.addAccountMember).not.toHaveBeenCalled();
  });
  it("a BIS write that throws after Clerk restored is caught and logged by id (mutation: let it throw -> FAILS)", async () => {
    db.addAccountMember.mockRejectedValue(new Error("down"));
    expect(await undoRemoveTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(logged()).toContain(STAFF_C.userId);
    expect(logged()).not.toContain("c@x.com");
  });
  it("a malformed user id is refused before anything is read", async () => {
    expect(await undoRemoveTeamMemberAction(ACCT, "user_C")).toEqual({ ok: false, error: "team.undo.failed" });
    expect(log.latestRemoval).not.toHaveBeenCalled();
  });
});

describe("revokeTeamInvitationAction and its undo", () => {
  it("revoke returns the email, role and language an undo needs", async () => {
    expect(await revokeTeamInvitationAction(ACCT, "orginv_1")).toEqual({ ok: true, undo: { email: "d@x.com", role: "owner", language: "es" } });
    expect(clerk.revokeTeamInvitation).toHaveBeenCalledWith("org_1", "orginv_1");
  });
  it("a malformed invitation id is refused before Clerk (mutation: drop the shape check -> FAILS)", async () => {
    expect(await revokeTeamInvitationAction(ACCT, "orginv_1/../../x")).toEqual({ ok: false, error: "team.revoke.failed" });
    expect(clerk.revokeTeamInvitation).not.toHaveBeenCalled();
  });
  it("Clerk failing is team.revoke.failed", async () => {
    clerk.revokeTeamInvitation.mockResolvedValue({ ok: false, code: "internal" });
    expect(await revokeTeamInvitationAction(ACCT, "orginv_1")).toEqual({ ok: false, error: "team.revoke.failed" });
  });
  it("undo re-invites with the same email, role and language", async () => {
    expect(await undoRevokeTeamInvitationAction(ACCT, "d@x.com", "owner", "es")).toEqual({ ok: true });
    expect(clerk.createTeamInvitation).toHaveBeenCalledWith({ orgId: "org_1", email: "d@x.com", role: "owner", language: "es", inviterUserId: "user_A" });
  });
  it("undo refuses a role or language it was never given (mutation: pass them through unchecked -> FAILS)", async () => {
    expect(await undoRevokeTeamInvitationAction(ACCT, "d@x.com", "admin" as never, "es")).toEqual({ ok: false, error: "team.invite.failed" });
    expect(await undoRevokeTeamInvitationAction(ACCT, "d@x.com", "owner", "fr" as never)).toEqual({ ok: false, error: "team.invite.failed" });
    expect(clerk.createTeamInvitation).not.toHaveBeenCalled();
  });
});

/**
 * F-085 part 1: the Technician on the Team screen, and a removal releasing
 * the person's customers and open tasks (spec §8, A3).
 */
const TECH_D = { userId: "44444444-4444-4444-8444-444444444444", clerkUserId: "user_D", email: "d@x.com", name: "D", role: "technician" as const, language: null };

describe("setTeamRoleAction: a move to Technician is a demotion", () => {
  it("Owner to Technician: Clerk FIRST, then BIS, then the repeat Clerk write, each with technician (mutation: leave `if (role === \"staff\")` -> the promotion path runs and the order FAILS)", async () => {
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "technician")).toEqual({ ok: true, previous: "owner" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_B", "technician"], ["org_1", "user_B", "technician"]]);
    expect(db.setAccountMemberRole.mock.calls).toEqual([[expect.anything(), ACCT, OWNER_B.userId, "technician"]]);
    expect(order(clerk.setOrganizationRole)).toBeLessThan(order(db.setAccountMemberRole));
    expect(order(db.setAccountMemberRole)).toBeLessThan(order(clerk.setOrganizationRole, 1));
  });
  it("Staff to Technician takes the same path", async () => {
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "technician")).toEqual({ ok: true, previous: "staff" });
    expect(order(clerk.setOrganizationRole)).toBeLessThan(order(db.setAccountMemberRole));
    expect(db.setAccountMemberRole).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId, "technician");
  });
  it("the last Owner made a Technician is refused, and Clerk is put back to owner (mutation: no Clerk restore -> FAILS)", async () => {
    db.setAccountMemberRole.mockResolvedValue("last_owner");
    expect(await setTeamRoleAction(ACCT, OWNER_A.userId, "technician")).toEqual({ ok: false, error: "team.lastOwner" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_A", "technician"], ["org_1", "user_A", "owner"]]);
  });
  it("Technician to Owner is a promotion: BIS first, and a refused Clerk write puts Clerk and BIS back to technician", async () => {
    db.listAccountTeam.mockResolvedValue([OWNER_A, TECH_D]);
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "form_param_value_invalid", status: 422 }).mockResolvedValueOnce({ ok: true });
    expect(await setTeamRoleAction(ACCT, TECH_D.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_D", "owner"], ["org_1", "user_D", "technician"]]);
    expect(db.setAccountMemberRole.mock.calls).toEqual([
      [expect.anything(), ACCT, TECH_D.userId, "owner"], [expect.anything(), ACCT, TECH_D.userId, "technician"]]);
  });
});

// Final review (A4 for a demotion): a Technician sees a task only on their own
// customer (or with no customer), so the open tasks someone held on anyone
// else's customers go back to Unassigned the moment they become a Technician.
describe("setTeamRoleAction: a person made a Technician lets go of tasks on customers that are not theirs", () => {
  it.each([["Owner", OWNER_B], ["Staff", STAFF_C]] as const)("%s to Technician releases them through the service client, AFTER the BIS role write returned ok (mutations: skip it, or run it before the BIS write -> FAILS)", async (_label, who) => {
    expect(await setTeamRoleAction(ACCT, who.userId, "technician")).toEqual({ ok: true, previous: who.role });
    expect(db.releaseTasksOffCustomers).toHaveBeenCalledTimes(1);
    const [releaseDb, acct, user] = db.releaseTasksOffCustomers.mock.calls[0]!;
    expect(releaseDb).toBe(db.serviceDb.mock.results.at(-1)!.value);
    expect([acct, user]).toEqual([ACCT, who.userId]);
    expect(order(db.setAccountMemberRole)).toBeLessThan(order(db.releaseTasksOffCustomers));
  });
  it("a move to Staff or Owner releases nothing (mutation: release on every role change -> FAILS)", async () => {
    await setTeamRoleAction(ACCT, OWNER_B.userId, "staff");
    db.listAccountTeam.mockResolvedValue([OWNER_A, TECH_D]);
    await setTeamRoleAction(ACCT, TECH_D.userId, "owner");
    expect(db.releaseTasksOffCustomers).not.toHaveBeenCalled();
  });
  it("a refused or failed demotion releases nothing (mutation: release before checking the BIS result -> FAILS)", async () => {
    db.setAccountMemberRole.mockResolvedValueOnce("last_owner");
    await setTeamRoleAction(ACCT, OWNER_A.userId, "technician");
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "internal", status: 500 });
    await setTeamRoleAction(ACCT, STAFF_C.userId, "technician");
    db.setAccountMemberRole.mockRejectedValueOnce(new Error("down"));
    await expect(setTeamRoleAction(ACCT, STAFF_C.userId, "technician")).rejects.toThrow("down");
    expect(db.releaseTasksOffCustomers).not.toHaveBeenCalled();
  });
  it("a release that throws is logged by id and the role change still stands (mutation: let it throw -> FAILS)", async () => {
    db.releaseTasksOffCustomers.mockRejectedValue(new Error("releaseTasksOffCustomers failed: down"));
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "technician")).toEqual({ ok: true, previous: "staff" });
    expect(logged()).toMatch(new RegExp(`tasks[^\\n]*${STAFF_C.userId}[^\\n]*releaseTasksOffCustomers failed: down`));
  });
});

describe("setTeamRoleAction: the promotion's set-back never writes a role more privileged than BIS holds", () => {
  it("BIS became Technician under the promotion: Clerk is set back to technician, not staff (mutation: always staff -> FAILS)", async () => {
    db.listAccountTeam.mockResolvedValueOnce([OWNER_A, OWNER_B, STAFF_C]).mockResolvedValue([OWNER_A, OWNER_B, { ...STAFF_C, role: "technician" }]);
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.changed" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_C", "owner"], ["org_1", "user_C", "technician"]]);
  });
  it("the person was removed meanwhile: the least privileged role, technician", async () => {
    db.listAccountTeam.mockResolvedValueOnce([OWNER_A, OWNER_B, STAFF_C]).mockResolvedValue([OWNER_A, OWNER_B]);
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.changed" });
    expect(clerk.setOrganizationRole).toHaveBeenLastCalledWith("org_1", "user_C", "technician");
  });
});

describe("removeTeamMemberAction releases the person's assignments (spec §8, A3)", () => {
  it("releases through the service client AFTER the BIS removal returned ok and Clerk removed them, and records the ids (mutations: release before the removal, or drop released from the record -> FAILS)", async () => {
    db.listAccountTeam.mockResolvedValue([OWNER_A, TECH_D]);
    expect(await removeTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true, undo: { userId: TECH_D.userId } });
    expect(db.releaseMemberAssignments).toHaveBeenCalledTimes(1);
    const [releaseDb, acct, user] = db.releaseMemberAssignments.mock.calls[0]!;
    expect(releaseDb).toBe(db.serviceDb.mock.results.at(-1)!.value);
    expect([acct, user]).toEqual([ACCT, TECH_D.userId]);
    expect(order(db.removeAccountMember)).toBeLessThan(order(db.releaseMemberAssignments));
    expect(order(clerk.removeFromOrganization)).toBeLessThan(order(db.releaseMemberAssignments));
    expect(order(db.releaseMemberAssignments)).toBeLessThan(order(log.recordRemoval));
    expect(log.recordRemoval).toHaveBeenCalledWith(expect.anything(), ACCT, "user_A",
      { userId: TECH_D.userId, clerkUserId: "user_D", role: "technician", language: null, released: RELEASED });
  });
  it("nothing is released when the removal is refused or Clerk fails (mutation: release before checking -> FAILS)", async () => {
    db.removeAccountMember.mockResolvedValue("last_owner");
    await removeTeamMemberAction(ACCT, OWNER_A.userId);
    db.removeAccountMember.mockResolvedValue("ok");
    clerk.removeFromOrganization.mockResolvedValue({ ok: false, code: "internal" });
    await removeTeamMemberAction(ACCT, STAFF_C.userId);
    expect(db.releaseMemberAssignments).not.toHaveBeenCalled();
  });
  // Fix round 1 (review M1): the retry runs BEFORE the removal is recorded,
  // so the ids a successful retry released are in the record the Undo reads.
  it("a release that throws is logged by id, the removal still stands (ok, with its undo), and the release is retried BEFORE the record, whose ids are recorded (mutations: let it throw, skip the retry, or retry after the record -> FAILS)", async () => {
    db.releaseMemberAssignments.mockRejectedValueOnce(new Error("releaseMemberAssignments failed: down")).mockResolvedValueOnce(RELEASED);
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true, undo: { userId: STAFF_C.userId } });
    expect(logged()).toMatch(new RegExp(`not released[^\\n]*${STAFF_C.userId}`));
    expect(db.releaseMemberAssignments).toHaveBeenCalledTimes(2);
    expect(order(db.releaseMemberAssignments, 1)).toBeLessThan(order(log.recordRemoval));
    expect(log.recordRemoval).toHaveBeenCalledWith(expect.anything(), ACCT, "user_A",
      { userId: STAFF_C.userId, clerkUserId: "user_C", role: "staff", language: "es", released: RELEASED });
  });
  it("a retry that also throws is logged and still never thrown; the record then says nothing was released", async () => {
    db.releaseMemberAssignments.mockRejectedValue(new Error("releaseMemberAssignments failed: down"));
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true, undo: { userId: STAFF_C.userId } });
    expect(logged().match(new RegExp(`not released[^\\n]*${STAFF_C.userId}`, "g"))?.length).toBe(2);
    expect(log.recordRemoval).toHaveBeenCalledWith(expect.anything(), ACCT, "user_A",
      { userId: STAFF_C.userId, clerkUserId: "user_C", role: "staff", language: "es", released: undefined });
  });
  it("a release that worked the first time is not repeated", async () => {
    await removeTeamMemberAction(ACCT, STAFF_C.userId);
    expect(db.releaseMemberAssignments).toHaveBeenCalledTimes(1);
  });
});

describe("undoRemoveTeamMemberAction gives back what the removal released", () => {
  it("re-assigns the recorded ids AFTER the membership and language are back (mutations: skip the reassign, or run it before the membership -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(db.reassignReleased).toHaveBeenCalledWith(expect.anything(), ACCT, TECH_D.userId, RELEASED);
    expect(order(db.addAccountMember)).toBeLessThan(order(db.reassignReleased));
    expect(order(db.setMemberLanguage)).toBeLessThan(order(db.reassignReleased));
    expect(clerk.restoreToOrganization).toHaveBeenCalledWith("org_1", "user_D", "technician");
  });
  // Fix round 1 (review I2): the person is back once the membership is, so a
  // give-back that fails is logged (account, user and the ids) and the undo
  // still succeeds; a second Undo heals it.
  it("a reassign that throws is logged with the account, the user and the ids, and the undo still succeeds: membership restored, team revalidated (mutation: share the membership's try -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    db.reassignReleased.mockRejectedValue(new Error("reassignReleased contacts failed: down"));
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(db.addAccountMember).toHaveBeenCalledWith(expect.anything(), { accountId: ACCT, userId: TECH_D.userId, role: "technician" });
    expect(db.setMemberLanguage).toHaveBeenCalledWith(expect.anything(), ACCT, TECH_D.userId, null);
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/${ACCT}/team`);
    const line = logged();
    for (const part of [ACCT, TECH_D.userId, RELEASED.contacts[0]!, RELEASED.tasks[0]!, "reassignReleased contacts failed: down"]) expect(line).toContain(part);
    expect(line).not.toMatch(/BIS write failed/);
  });
  it("a second Undo (Clerk: already a member, BIS role matches) gives the recorded ids back again, so a failed give-back heals (mutation: return ok without reassigning -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "already_a_member_in_organization" });
    db.listAccountTeam.mockResolvedValue([OWNER_A, TECH_D]);
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(db.reassignReleased).toHaveBeenCalledWith(expect.anything(), ACCT, TECH_D.userId, RELEASED);
    expect(db.addAccountMember).not.toHaveBeenCalled();
  });
  it("first Undo's give-back fails, second Undo runs it again and it lands", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    db.reassignReleased.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(undefined);
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "already_a_member_in_organization" });
    db.listAccountTeam.mockResolvedValue([OWNER_A, TECH_D]);
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(db.reassignReleased).toHaveBeenCalledTimes(2);
  });
  it("a removal that released nothing (or an old record) gives nothing back, on either path", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D));
    await undoRemoveTeamMemberAction(ACCT, TECH_D.userId);
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "already_a_member_in_organization" });
    db.listAccountTeam.mockResolvedValue([OWNER_A, TECH_D]);
    await undoRemoveTeamMemberAction(ACCT, TECH_D.userId);
    expect(db.reassignReleased).not.toHaveBeenCalled();
  });
  it("a membership write that throws is still team.undo.failed, logged as the membership, and gives nothing back", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    db.addAccountMember.mockRejectedValue(new Error("down"));
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(logged()).toMatch(/membership/);
    expect(db.reassignReleased).not.toHaveBeenCalled();
  });
  // Final review I-1: a Clerk membership left behind with no BIS row is
  // reconciled by the webhook or the per-request fallback, and the Team card
  // would say "could not undo" about a person who then comes back anyway.
  it("a BIS membership write that throws after Clerk restored takes the Clerk membership away again, and any half-written BIS row with it (mutation: leave Clerk restored -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    db.addAccountMember.mockRejectedValue(new Error("down"));
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(clerk.removeFromOrganization).toHaveBeenCalledWith("org_1", "user_D");
    expect(order(db.addAccountMember)).toBeLessThan(order(clerk.removeFromOrganization));
    expect(db.deleteAccountMembership).toHaveBeenCalledWith(expect.anything(), ACCT, TECH_D.userId);
  });
  it("the existing row's role set throwing takes Clerk back too (mutation: guard only addAccountMember -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D));
    db.addAccountMember.mockResolvedValue("existed");
    db.setAccountMemberRole.mockRejectedValue(new Error("down"));
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(clerk.removeFromOrganization).toHaveBeenCalledWith("org_1", "user_D");
  });
  it("a take-back that Clerk refuses is logged by id as a membership left without its BIS row (mutation: no log -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D));
    db.addAccountMember.mockRejectedValue(new Error("down"));
    clerk.removeFromOrganization.mockResolvedValue({ ok: false, code: "internal", status: 500 });
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(logged()).toMatch(new RegExp(`still in Clerk[^\\n]*${TECH_D.userId}`));
  });
  // Final re-review: a `created` webhook can settle the restored membership
  // before bis_role lands and re-assert "staff" onto Clerk. Once BIS holds the
  // role, Clerk is made to follow it.
  it("once the BIS membership is back, Clerk is re-asserted to the restored role (mutation: skip the reassert -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D));
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(clerk.reassertClerkRole).toHaveBeenCalledWith("org_1", "user_D", "technician");
    expect(order(db.addAccountMember)).toBeLessThan(order(clerk.reassertClerkRole));
  });
  it("…after the existing row's role is set, when the webhook made the row first (mutation: reassert before the role set -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D));
    db.addAccountMember.mockResolvedValue("existed");
    await undoRemoveTeamMemberAction(ACCT, TECH_D.userId);
    expect(order(db.setAccountMemberRole)).toBeLessThan(order(clerk.reassertClerkRole));
  });
  it("a double-clicked Undo re-asserts too, so a second Undo heals stale Clerk metadata", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D));
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "already_a_member_in_organization" });
    db.listAccountTeam.mockResolvedValue([OWNER_A, TECH_D]);
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(clerk.reassertClerkRole).toHaveBeenCalledWith("org_1", "user_D", "technician");
  });
  it("a reassert that fails is logged by id and the undo still succeeds; a failed BIS write never reasserts (mutation: fail the undo on it -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D));
    clerk.reassertClerkRole.mockResolvedValue({ ok: false, code: "internal", status: 500 });
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(logged()).toMatch(new RegExp(`re-assert[^\\n]*${TECH_D.userId}`));
    clerk.reassertClerkRole.mockClear();
    db.addAccountMember.mockRejectedValue(new Error("down"));
    await undoRemoveTeamMemberAction(ACCT, TECH_D.userId);
    expect(clerk.reassertClerkRole).not.toHaveBeenCalled();
  });
  it("a language write that throws after the membership is back does not fail the undo or take anyone out of Clerk (mutation: share the membership's try -> FAILS)", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    db.setMemberLanguage.mockRejectedValue(new Error("down"));
    expect(await undoRemoveTeamMemberAction(ACCT, TECH_D.userId)).toEqual({ ok: true });
    expect(clerk.removeFromOrganization).not.toHaveBeenCalled();
    expect(db.reassignReleased).toHaveBeenCalled();
    expect(logged()).toMatch(new RegExp(`language[^\\n]*${TECH_D.userId}`));
  });
  it("Clerk refusing the undo never reassigns", async () => {
    log.latestRemoval.mockResolvedValue(removal(TECH_D, 10_000, RELEASED));
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "internal" });
    await undoRemoveTeamMemberAction(ACCT, TECH_D.userId);
    expect(db.reassignReleased).not.toHaveBeenCalled();
  });
});
