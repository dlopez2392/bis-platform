import { describe, it, expect, vi, beforeEach } from "vitest";

// revalidatePath throws outside a request ("static generation store missing").
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const guard = vi.hoisted(() => ({ requireAccountOwner: vi.fn() }));
vi.mock("@/lib/auth", () => guard);

// serviceDb(): the account read (`accounts`, select("*")). `from` is a spy so
// a guard test can prove the database was never reached.
const rows = vi.hoisted(() => ({
  account: { id: "acct", clerk_org_id: "org_1", client_access_enabled: true } as Record<string, unknown> | null,
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

function fakeDb() {
  from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq"]) chain[k] = () => chain;
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
function removal(member: { userId: string; clerkUserId: string; role: "owner" | "staff"; language: "en" | "es" | null }, agoMs = 10_000) {
  return { userId: member.userId, clerkUserId: member.clerkUserId, role: member.role, language: member.language, removedAt: new Date(Date.now() - agoMs).toISOString() };
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
  clerk.teamCapacity.mockResolvedValue({ maxAllowed: 5, members: 3, pending: 0 });
  clerk.createTeamInvitation.mockResolvedValue({ ok: true });
  clerk.revokeTeamInvitation.mockResolvedValue({ ok: true, invite: { id: "orginv_1", email: "d@x.com", role: "owner", language: "es" } });
  clerk.removeFromOrganization.mockResolvedValue({ ok: true });
  clerk.restoreToOrganization.mockResolvedValue({ ok: true });
  clerk.setOrganizationRole.mockResolvedValue({ ok: true });
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
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: true, previous: "staff" });
    expect(clerk.setOrganizationRole).toHaveBeenCalledWith("org_1", "user_C", "owner");
    expect(order(db.setAccountMemberRole)).toBeLessThan(order(clerk.setOrganizationRole));
  });
  it("BIS not_found: Clerk is never touched", async () => {
    db.setAccountMemberRole.mockResolvedValue("not_found");
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.changed" });
    expect(clerk.setOrganizationRole).not.toHaveBeenCalled();
  });
  it("Clerk refuses: Clerk is set back to member FIRST, then BIS rolls back to Staff (mutations: roll back to owner, or roll BIS back before Clerk -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "internal" }).mockResolvedValueOnce({ ok: true });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(clerk.setOrganizationRole.mock.calls).toEqual([["org_1", "user_C", "owner"], ["org_1", "user_C", "staff"]]);
    expect(db.setAccountMemberRole.mock.calls).toEqual([
      [expect.anything(), ACCT, STAFF_C.userId, "owner"], [expect.anything(), ACCT, STAFF_C.userId, "staff"]]);
    expect(order(clerk.setOrganizationRole, 1)).toBeLessThan(order(db.setAccountMemberRole, 1));
  });
  it("Clerk refuses and the set-back also fails: BIS is LEFT at Owner (the safe side) and logged (mutation: roll BIS back anyway -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValue({ ok: false, code: "internal" });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(db.setAccountMemberRole).toHaveBeenCalledTimes(1);
    expect(logged()).toContain(STAFF_C.userId);
  });
  it("a Clerk TIMEOUT may still land later, so BIS is left at Owner even when the set-back answered (mutation: treat timeout like a refusal -> FAILS)", async () => {
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "timeout" }).mockResolvedValueOnce({ ok: true });
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(db.setAccountMemberRole).toHaveBeenCalledTimes(1);
  });
  it("a BIS rollback that throws is logged by id and still reported as a failure", async () => {
    clerk.setOrganizationRole.mockResolvedValueOnce({ ok: false, code: "internal" }).mockResolvedValueOnce({ ok: true });
    db.setAccountMemberRole.mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("down"));
    expect(await setTeamRoleAction(ACCT, STAFF_C.userId, "owner")).toEqual({ ok: false, error: "team.role.failed" });
    expect(logged()).toContain(STAFF_C.userId);
    expect(logged()).not.toContain("c@x.com");
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
      { userId: STAFF_C.userId, clerkUserId: "user_C", role: "staff", language: "es" });
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
