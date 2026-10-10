import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake of the slice of @clerk/backend's ClerkClient this adapter touches.
// Method names and shapes are the installed @clerk/backend 3.13.1's
// (dist/api/endpoints/UserApi.d.ts, OrganizationApi.d.ts).
const users = { getUser: vi.fn() };
const organizations = {
  getOrganization: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  getOrganizationInvitationList: vi.fn(),
  createOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  deleteOrganizationMembership: vi.fn(),
  createOrganizationMembership: vi.fn(),
};
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users, organizations }) }));

import {
  liveClerkTeamPort, listPendingInvitations, teamCapacity, createTeamInvitation,
  revokeTeamInvitation, removeFromOrganization, restoreToOrganization,
} from "./clerk-team";

/** Shaped like @clerk/shared's ClerkAPIResponseError: `status` plus `errors[].code`. */
function clerkError(status: number, code: string, message = `clerk said no to pat@example.com`) {
  return Object.assign(new Error(message), { status, errors: [{ code, message }] });
}

beforeEach(() => {
  for (const f of [...Object.values(users), ...Object.values(organizations)]) f.mockReset();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("liveClerkTeamPort.getUser", () => {
  it("maps the primary email, full name and public metadata", async () => {
    users.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "pat@example.com" }, fullName: "Pat Doe", publicMetadata: { app_role: "x" },
    });
    expect(await liveClerkTeamPort().getUser("user_1")).toEqual({ email: "pat@example.com", name: "Pat Doe", publicMetadata: { app_role: "x" } });
    expect(users.getUser).toHaveBeenCalledWith("user_1");
  });
  it("a user with no primary email maps to email null", async () => {
    users.getUser.mockResolvedValue({ primaryEmailAddress: null, fullName: null, publicMetadata: {} });
    expect(await liveClerkTeamPort().getUser("user_1")).toEqual({ email: null, name: null, publicMetadata: {} });
  });
  it("a 404 is null, not a throw (mutation: rethrow every error -> FAILS)", async () => {
    users.getUser.mockRejectedValue(clerkError(404, "resource_not_found"));
    expect(await liveClerkTeamPort().getUser("user_gone")).toBeNull();
  });
  it("any other failure throws, so the fallback fails closed (mutation: null on every error -> FAILS)", async () => {
    users.getUser.mockRejectedValue(clerkError(503, "service_unavailable"));
    await expect(liveClerkTeamPort().getUser("user_1")).rejects.toThrow();
  });
});

describe("liveClerkTeamPort.getMembership", () => {
  it("asks the organisation about this one user and returns its role and metadata", async () => {
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [
      { role: "org:admin", publicMetadata: { bis_role: "staff" }, organization: { id: "org_1" }, publicUserData: { userId: "user_1" } },
    ], totalCount: 1 });
    expect(await liveClerkTeamPort().getMembership("user_1", "org_1")).toEqual({ role: "org:admin", publicMetadata: { bis_role: "staff" } });
    expect(organizations.getOrganizationMembershipList).toHaveBeenCalledWith({ organizationId: "org_1", userId: ["user_1"] });
  });
  it("an entry for another org or another user is not this membership (mutation: take data[0] unchecked -> FAILS)", async () => {
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [
      { role: "org:admin", publicMetadata: {}, organization: { id: "org_other" }, publicUserData: { userId: "user_1" } },
      { role: "org:admin", publicMetadata: {}, organization: { id: "org_1" }, publicUserData: { userId: "user_other" } },
    ], totalCount: 2 });
    expect(await liveClerkTeamPort().getMembership("user_1", "org_1")).toBeNull();
  });
  it("no membership is null", async () => {
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [], totalCount: 0 });
    expect(await liveClerkTeamPort().getMembership("user_1", "org_1")).toBeNull();
  });
});

describe("liveClerkTeamPort.acceptedInvitationMeta", () => {
  it("matches the accepted invitation by email, ignoring case, newest first (mutation: exact-case match -> FAILS)", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { emailAddress: "Pat@Example.com", createdAt: 1, publicMetadata: { bis_role: "staff" } },
      { emailAddress: "PAT@example.COM", createdAt: 2, publicMetadata: { bis_role: "owner" } },
      { emailAddress: "someone@else.com", createdAt: 3, publicMetadata: { bis_role: "staff" } },
    ], totalCount: 3 });
    expect(await liveClerkTeamPort().acceptedInvitationMeta("org_1", "pat@example.com")).toEqual({ bis_role: "owner" });
    expect(organizations.getOrganizationInvitationList).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", status: ["accepted"] }));
  });
  it("no matching invitation is null", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [], totalCount: 0 });
    expect(await liveClerkTeamPort().acceptedInvitationMeta("org_1", "pat@example.com")).toBeNull();
  });
});

describe("the Team's Clerk calls", () => {
  it("listPendingInvitations maps role and language from the invitation's own metadata", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { id: "orginv_1", emailAddress: "a@x.com", role: "org:member", publicMetadata: { bis_role: "owner", bis_language: "es" } },
      { id: "orginv_2", emailAddress: "b@x.com", role: "org:member", publicMetadata: {} },
    ], totalCount: 2 });
    expect(await listPendingInvitations("org_1")).toEqual([
      { id: "orginv_1", email: "a@x.com", role: "owner", language: "es" },
      { id: "orginv_2", email: "b@x.com", role: "staff", language: "en" },
    ]);
    expect(organizations.getOrganizationInvitationList).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", status: ["pending"] }));
  });
  it("listPendingInvitations throws when Clerk is down, without the raw address (the Team card shows its unreachable state)", async () => {
    organizations.getOrganizationInvitationList.mockRejectedValue(clerkError(503, "x"));
    await expect(listPendingInvitations("org_1")).rejects.toThrow();
    await expect(listPendingInvitations("org_1")).rejects.not.toThrow(/pat@example\.com/);
  });
  it("teamCapacity reads the cap, the member count and the pending count (0 = no cap)", async () => {
    organizations.getOrganization.mockResolvedValue({ maxAllowedMemberships: 5, membersCount: 3 });
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [], totalCount: 1 });
    expect(await teamCapacity("org_1")).toEqual({ maxAllowed: 5, members: 3, pending: 1 });
    expect(organizations.getOrganization).toHaveBeenCalledWith({ organizationId: "org_1", includeMembersCount: true });
    organizations.getOrganization.mockResolvedValue({ maxAllowedMemberships: 0, membersCount: 3 });
    expect((await teamCapacity("org_1")).maxAllowed).toBeNull();
  });
  it("teamCapacity counts the membership list when the organisation omits membersCount", async () => {
    organizations.getOrganization.mockResolvedValue({ maxAllowedMemberships: 5 });
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [], totalCount: 4 });
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [], totalCount: 0 });
    expect(await teamCapacity("org_1")).toEqual({ maxAllowed: 5, members: 4, pending: 0 });
  });
  it("createTeamInvitation invites as org:member and carries bis_role and bis_language (mutation: org:admin -> FAILS)", async () => {
    organizations.createOrganizationInvitation.mockResolvedValue({ id: "orginv_1" });
    expect(await createTeamInvitation({ orgId: "org_1", email: "a@x.com", role: "staff", language: "en", inviterUserId: "user_owner" }))
      .toEqual({ ok: true });
    expect(organizations.createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: "org_1", emailAddress: "a@x.com", role: "org:member", inviterUserId: "user_owner",
      publicMetadata: { bis_role: "staff", bis_language: "en" },
    });
  });
  it("createTeamInvitation returns Clerk's error code and logs without the address (mutation: throw -> FAILS)", async () => {
    organizations.createOrganizationInvitation.mockRejectedValue(clerkError(422, "duplicate_record"));
    expect(await createTeamInvitation({ orgId: "org_1", email: "pat@example.com", role: "staff", language: "en", inviterUserId: "u" }))
      .toEqual({ ok: false, code: "duplicate_record" });
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
  it("revokeTeamInvitation returns what an undo needs", async () => {
    organizations.revokeOrganizationInvitation.mockResolvedValue({
      id: "orginv_1", emailAddress: "a@x.com", role: "org:member", publicMetadata: { bis_role: "owner", bis_language: "es" },
    });
    expect(await revokeTeamInvitation("org_1", "orginv_1", "user_owner")).toEqual({
      ok: true, invite: { id: "orginv_1", email: "a@x.com", role: "owner", language: "es" },
    });
    expect(organizations.revokeOrganizationInvitation).toHaveBeenCalledWith({ organizationId: "org_1", invitationId: "orginv_1", requestingUserId: "user_owner" });
  });
  it("removeFromOrganization deletes the Clerk membership and reports failure as a result", async () => {
    organizations.deleteOrganizationMembership.mockResolvedValue({});
    expect(await removeFromOrganization("org_1", "user_1")).toEqual({ ok: true });
    expect(organizations.deleteOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1" });
    organizations.deleteOrganizationMembership.mockRejectedValue(clerkError(500, "internal"));
    expect(await removeFromOrganization("org_1", "user_1")).toEqual({ ok: false, code: "internal" });
  });
  it("restoreToOrganization re-adds as org:member, never org:admin (mutation: org:admin -> FAILS)", async () => {
    organizations.createOrganizationMembership.mockResolvedValue({});
    expect(await restoreToOrganization("org_1", "user_1")).toEqual({ ok: true });
    expect(organizations.createOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", role: "org:member" });
  });
});
