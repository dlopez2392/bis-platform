import { describe, it, expect, vi, beforeEach } from "vitest";

// revalidatePath throws outside a request ("static generation store missing").
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const guard = vi.hoisted(() => ({ requireAccountOwner: vi.fn() }));
vi.mock("@/lib/auth", () => guard);

// serviceDb(): the account read (`accounts`, select("*")) and the undo's
// user lookup (`users` by clerk_user_id). `from` is a spy so a guard test can
// prove the database was never reached.
const rows = vi.hoisted(() => ({
  account: { id: "acct", clerk_org_id: "org_1", client_access_enabled: true } as Record<string, unknown> | null,
  user: { id: "33333333-3333-4333-8333-333333333333" } as Record<string, unknown> | null,
}));
const from = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  listAccountTeam: vi.fn(), setAccountMemberRole: vi.fn(), setMemberLanguage: vi.fn(),
  removeAccountMember: vi.fn(), addAccountMember: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

const clerk = vi.hoisted(() => ({
  teamCapacity: vi.fn(), createTeamInvitation: vi.fn(), revokeTeamInvitation: vi.fn(),
  removeFromOrganization: vi.fn(), restoreToOrganization: vi.fn(), setOrganizationRole: vi.fn(),
}));
vi.mock("@/lib/team/clerk-team", () => clerk);

import {
  inviteTeamMemberAction, setTeamRoleAction, setTeamLanguageAction, removeTeamMemberAction,
  undoRemoveTeamMemberAction, revokeTeamInvitationAction, undoRevokeTeamInvitationAction,
} from "./actions";

const ACCT = "acct";
const OWNER_A = { userId: "11111111-1111-4111-8111-111111111111", clerkUserId: "user_A", email: "a@x.com", name: "A", role: "owner" as const, language: "en" as const };
const OWNER_B = { userId: "22222222-2222-4222-8222-222222222222", clerkUserId: "user_B", email: "b@x.com", name: "B", role: "owner" as const, language: null };
const STAFF_C = { userId: "33333333-3333-4333-8333-333333333333", clerkUserId: "user_C", email: "c@x.com", name: "C", role: "staff" as const, language: "es" as const };

function fakeDb() {
  from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq"]) chain[k] = () => chain;
    chain.maybeSingle = async () => ({ data: table === "accounts" ? rows.account : table === "users" ? rows.user : null, error: null });
    return chain;
  });
  return { from };
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const allDataMocks = () => [from, ...Object.values(db).filter((f) => f !== db.serviceDb), ...Object.values(clerk)];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rows.account = { id: ACCT, clerk_org_id: "org_1", client_access_enabled: true };
  rows.user = { id: STAFF_C.userId };
  guard.requireAccountOwner.mockResolvedValue({ userId: "user_A", isAgency: false });
  db.serviceDb.mockImplementation(fakeDb);
  db.listAccountTeam.mockResolvedValue([OWNER_A, OWNER_B, STAFF_C]);
  db.setAccountMemberRole.mockResolvedValue("ok");
  db.setMemberLanguage.mockResolvedValue("ok");
  db.removeAccountMember.mockResolvedValue("ok");
  db.addAccountMember.mockResolvedValue("created");
  clerk.teamCapacity.mockResolvedValue({ maxAllowed: 5, members: 3, pending: 0 });
  clerk.createTeamInvitation.mockResolvedValue({ ok: true });
  clerk.revokeTeamInvitation.mockResolvedValue({ ok: true, invite: { id: "orginv_1", email: "d@x.com", role: "owner", language: "es" } });
  clerk.removeFromOrganization.mockResolvedValue({ ok: true });
  clerk.restoreToOrganization.mockResolvedValue({ ok: true });
  clerk.setOrganizationRole.mockResolvedValue({ ok: true });
});

describe("Staff calling an Owner action is redirected before anything is read or written", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["inviteTeamMemberAction", () => inviteTeamMemberAction(ACCT, form({ email: "d@x.com" }))],
    ["setTeamRoleAction", () => setTeamRoleAction(ACCT, STAFF_C.userId, "owner")],
    ["setTeamLanguageAction", () => setTeamLanguageAction(ACCT, STAFF_C.userId, "en")],
    ["removeTeamMemberAction", () => removeTeamMemberAction(ACCT, STAFF_C.userId)],
    ["undoRemoveTeamMemberAction", () => undoRemoveTeamMemberAction(ACCT, "user_C", "staff")],
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

describe("setTeamRoleAction (the Clerk role follows the BIS role)", () => {
  it("writes BIS first, then sets the Clerk role to match, and returns the previous role for the undo (mutation: skip the Clerk update -> FAILS)", async () => {
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: true, previous: "owner" });
    expect(db.setAccountMemberRole).toHaveBeenCalledWith(expect.anything(), ACCT, OWNER_B.userId, "staff");
    expect(clerk.setOrganizationRole).toHaveBeenCalledWith("org_1", "user_B", "staff");
    expect(db.setAccountMemberRole.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(clerk.setOrganizationRole.mock.invocationCallOrder[0] ?? -1);
  });
  it("undo is the same action with previous, and it restores the Clerk role too", async () => {
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "owner")).toEqual({ ok: true, previous: "owner" });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: true, previous: "staff" });
    expect(clerk.setOrganizationRole).toHaveBeenLastCalledWith("org_1", "user_C", "owner");
  });
  it("Last Owner: BIS refuses first and Clerk is never touched (mutation: call Clerk first -> FAILS)", async () => {
    db.setAccountMemberRole.mockResolvedValue("last_owner");
    expect(await setTeamRoleAction(ACCT, OWNER_A.userId, "staff")).toEqual({ ok: false, error: "team.lastOwner" });
    expect(clerk.setOrganizationRole).not.toHaveBeenCalled();
  });
  it("BIS fails first: not_found is team.changed, a throw propagates, and Clerk is never touched", async () => {
    db.setAccountMemberRole.mockResolvedValue("not_found");
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: false, error: "team.changed" });
    db.setAccountMemberRole.mockRejectedValue(new Error("setAccountMemberRole failed: down"));
    await expect(setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).rejects.toThrow();
    expect(clerk.setOrganizationRole).not.toHaveBeenCalled();
  });
  it("Clerk fails second: retried once, then BIS is rolled back to the previous role so BIS Staff never sits beside Clerk admin (mutation: drop the rollback -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValue({ ok: false, code: "internal" });
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: false, error: "team.role.failed" });
    expect(clerk.setOrganizationRole).toHaveBeenCalledTimes(2);
    expect(db.setAccountMemberRole).toHaveBeenNthCalledWith(1, expect.anything(), ACCT, OWNER_B.userId, "staff");
    expect(db.setAccountMemberRole).toHaveBeenNthCalledWith(2, expect.anything(), ACCT, OWNER_B.userId, "owner");
  });
  it("a Clerk blip that the retry clears is a success, with no rollback (mutation: no retry -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "internal" }).mockResolvedValueOnce({ ok: true });
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: true, previous: "owner" });
    expect(db.setAccountMemberRole).toHaveBeenCalledTimes(1);
  });
  it("a rollback that also fails is logged by id, never by address, and still reported as a failure", async () => {
    clerk.setOrganizationRole.mockResolvedValue({ ok: false, code: "internal" });
    db.setAccountMemberRole.mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("down"));
    expect(await setTeamRoleAction(ACCT, OWNER_B.userId, "staff")).toEqual({ ok: false, error: "team.role.failed" });
    const logged = vi.mocked(console.error).mock.calls.map(String).join("\n");
    expect(logged).toContain(OWNER_B.userId);
    expect(logged).not.toContain("b@x.com");
  });
  it("someone no longer on the team, or a malformed id or role, is team.changed and writes nothing", async () => {
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
  it("removes in BIS (the guard), then from the Clerk org, and returns the undo (mutation: skip the Clerk removal -> FAILS)", async () => {
    expect(await removeTeamMemberAction(ACCT, STAFF_C.userId)).toEqual({ ok: true, undo: { clerkUserId: "user_C", role: "staff" } });
    expect(db.removeAccountMember).toHaveBeenCalledWith(expect.anything(), ACCT, STAFF_C.userId);
    expect(clerk.removeFromOrganization).toHaveBeenCalledWith("org_1", "user_C");
  });
  it("Last Owner: refused, and the Clerk membership is never removed (mutation: call Clerk first -> FAILS)", async () => {
    db.removeAccountMember.mockResolvedValue("last_owner");
    expect(await removeTeamMemberAction(ACCT, OWNER_A.userId)).toEqual({ ok: false, error: "team.lastOwner" });
    expect(clerk.removeFromOrganization).not.toHaveBeenCalled();
  });
  it("Remove rollback: Clerk failing after the database delete re-adds the BIS row at the original role (mutation: re-add as staff -> FAILS)", async () => {
    clerk.removeFromOrganization.mockResolvedValue({ ok: false, code: "internal" });
    expect(await removeTeamMemberAction(ACCT, OWNER_B.userId)).toEqual({ ok: false, error: "team.remove.failed" });
    expect(db.addAccountMember).toHaveBeenCalledWith(expect.anything(), { accountId: ACCT, userId: OWNER_B.userId, role: "owner" });
  });
});

describe("undoRemoveTeamMemberAction", () => {
  it("re-adds through Clerk at the same role, then the BIS membership (mutation: restore without the role -> FAILS)", async () => {
    expect(await undoRemoveTeamMemberAction(ACCT, "user_B", "owner")).toEqual({ ok: true });
    expect(clerk.restoreToOrganization).toHaveBeenCalledWith("org_1", "user_B", "owner");
    expect(db.addAccountMember).toHaveBeenCalledWith(expect.anything(), { accountId: ACCT, userId: STAFF_C.userId, role: "owner" });
    expect(clerk.restoreToOrganization.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(db.addAccountMember.mock.invocationCallOrder[0] ?? -1);
  });
  it("Clerk refusing leaves BIS untouched", async () => {
    clerk.restoreToOrganization.mockResolvedValue({ ok: false, code: "internal" });
    expect(await undoRemoveTeamMemberAction(ACCT, "user_B", "owner")).toEqual({ ok: false, error: "team.undo.failed" });
    expect(db.addAccountMember).not.toHaveBeenCalled();
  });
  it("a person BIS has never stored, or a malformed id or role, is refused before Clerk", async () => {
    rows.user = null;
    expect(await undoRemoveTeamMemberAction(ACCT, "user_B", "owner")).toEqual({ ok: false, error: "team.undo.failed" });
    expect(await undoRemoveTeamMemberAction(ACCT, "org_1", "owner")).toEqual({ ok: false, error: "team.undo.failed" });
    expect(await undoRemoveTeamMemberAction(ACCT, "user_B", "admin" as never)).toEqual({ ok: false, error: "team.undo.failed" });
    expect(clerk.restoreToOrganization).not.toHaveBeenCalled();
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
