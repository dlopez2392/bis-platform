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
  updateOrganizationMembership: vi.fn(),
};
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users, organizations }) }));

import { reconcileMembership, type SupabaseClient } from "@bis/db";
import {
  liveClerkTeamPort, listPendingInvitations, teamCapacity, createTeamInvitation,
  revokeTeamInvitation, removeFromOrganization, restoreToOrganization, setOrganizationRole,
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
  it("asks the organisation about this one user and returns its role, metadata and creation time", async () => {
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [
      { role: "org:admin", publicMetadata: { bis_role: "staff" }, createdAt: 1234, organization: { id: "org_1" }, publicUserData: { userId: "user_1" } },
    ], totalCount: 1 });
    expect(await liveClerkTeamPort().getMembership("user_1", "org_1")).toEqual({ role: "org:admin", publicMetadata: { bis_role: "staff" }, createdAt: 1234 });
    expect(organizations.getOrganizationMembershipList).toHaveBeenCalledWith({ organizationId: "org_1", userId: ["user_1"] });
  });
  it("an entry for another org or another user is not this membership (mutation: take data[0] unchecked -> FAILS)", async () => {
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [
      { role: "org:admin", publicMetadata: {}, createdAt: 1, organization: { id: "org_other" }, publicUserData: { userId: "user_1" } },
      { role: "org:admin", publicMetadata: {}, createdAt: 1, organization: { id: "org_1" }, publicUserData: { userId: "user_other" } },
    ], totalCount: 2 });
    expect(await liveClerkTeamPort().getMembership("user_1", "org_1")).toBeNull();
  });
  it("no membership is null", async () => {
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [], totalCount: 0 });
    expect(await liveClerkTeamPort().getMembership("user_1", "org_1")).toBeNull();
  });
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

describe("liveClerkTeamPort.acceptedInvitationMeta", () => {
  it("matches by email ignoring case, and takes the most recently ACCEPTED wherever it sits in the list (mutations: exact-case match, .at(-1), drop the sort -> each FAILS)", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { emailAddress: "Pat@Example.com", createdAt: 1, updatedAt: NOW + 100, publicMetadata: { bis_role: "staff" } },
      { emailAddress: "PAT@example.COM", createdAt: 2, updatedAt: NOW + 300, publicMetadata: { bis_role: "owner" } },
      { emailAddress: "pat@example.com", createdAt: 3, updatedAt: NOW + 200, publicMetadata: { bis_role: "staff" } },
      { emailAddress: "someone@else.com", createdAt: 4, updatedAt: NOW + 900, publicMetadata: { bis_role: "staff" } },
    ], totalCount: 4 });
    expect(await liveClerkTeamPort().acceptedInvitationMeta("org_1", "pat@example.com", NOW)).toEqual({ bis_role: "owner" });
  });
  it("reads a full page of accepted invitations, not Clerk's default 10 (mutation: drop limit -> FAILS)", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [], totalCount: 0 });
    await liveClerkTeamPort().acceptedInvitationMeta("org_1", "pat@example.com", NOW);
    expect(organizations.getOrganizationInvitationList).toHaveBeenCalledWith({ organizationId: "org_1", status: ["accepted"], limit: 500 });
  });
  it("ignores an invitation accepted before acceptedSince, the one an OLD membership used (mutation: drop the acceptedSince filter -> FAILS)", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { emailAddress: "pat@example.com", createdAt: NOW - 400 * DAY, updatedAt: NOW - 399 * DAY, publicMetadata: { bis_role: "owner" } },
    ], totalCount: 1 });
    expect(await liveClerkTeamPort().acceptedInvitationMeta("org_1", "pat@example.com", NOW)).toBeNull();
  });
  it("honours an invitation SENT long ago but accepted at the bound, since acceptance is what counts (mutations: compare createdAt, or > instead of >= -> FAILS)", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { emailAddress: "pat@example.com", createdAt: NOW - 20 * DAY, updatedAt: NOW, publicMetadata: { bis_role: "owner" } },
    ], totalCount: 1 });
    expect(await liveClerkTeamPort().acceptedInvitationMeta("org_1", "pat@example.com", NOW)).toEqual({ bis_role: "owner" });
  });
  it("no matching invitation is null", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [], totalCount: 0 });
    expect(await liveClerkTeamPort().acceptedInvitationMeta("org_1", "pat@example.com", NOW)).toBeNull();
  });
});

/** Chainable fake SupabaseClient: builder methods record and chain; maybeSingle/single and await resolve to respond(table, ops). */
function chainDb(respond: (table: string, ops: string[]) => { data: unknown; error: unknown }): SupabaseClient {
  return {
    from(table: string) {
      const ops: string[] = [];
      const b: Record<string | symbol, unknown> = new Proxy({}, {
        get(_t, k) {
          if (k === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(table, ops)).then(res, rej);
          if (k === "maybeSingle" || k === "single") return async () => respond(table, [...ops, String(k)]);
          return () => { ops.push(String(k)); return b; };
        },
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("re-added after removal: the real reconcile with this adapter (spec §6, review I1)", () => {
  // Pat was invited as Owner and accepted 400 days ago, later removed, and is
  // now re-added directly as org:member (Clerk's dashboard, or the Team undo).
  function settle(invite: { createdAt: number; updatedAt: number }) {
    users.getUser.mockResolvedValue({ primaryEmailAddress: { emailAddress: "pat@example.com" }, fullName: "Pat", publicMetadata: {} });
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [
      { role: "org:member", publicMetadata: {}, createdAt: NOW, organization: { id: "org_1" }, publicUserData: { userId: "user_1" } },
    ], totalCount: 1 });
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { emailAddress: "pat@example.com", ...invite, publicMetadata: { bis_role: "owner" } },
    ], totalCount: 1 });
    const db = chainDb((table, ops) => {
      if (table === "accounts") return { data: { id: "acct" }, error: null };
      if (table === "users") return { data: { id: "u1", language: "en" }, error: null };
      return ops.includes("upsert") ? { data: [{ id: "m1" }], error: null } : { data: null, error: null };
    });
    return reconcileMembership(db, liveClerkTeamPort(), { clerkUserId: "user_1", clerkOrgId: "org_1", mode: "fallback" });
  }
  it("the old Owner invitation is ignored: Pat comes back as Staff (mutation: reconcile passes acceptedSince 0 -> FAILS)", async () => {
    expect(await settle({ createdAt: NOW - 401 * DAY, updatedAt: NOW - 400 * DAY })).toEqual({ outcome: "created", role: "staff" });
  });
  it("an invitation accepted for this membership is honoured: Owner (mutation: never honour an invitation -> FAILS)", async () => {
    expect(await settle({ createdAt: NOW - 2 * DAY, updatedAt: NOW - 60 * 1000 })).toEqual({ outcome: "created", role: "owner" });
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
      expect.objectContaining({ organizationId: "org_1", status: ["pending"], limit: 500 }));
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
  it("createTeamInvitation invites Staff as org:member and carries bis_role and bis_language (mutation: org:admin -> FAILS)", async () => {
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
  it("createTeamInvitation invites an Owner as org:admin, so the Clerk role follows the BIS role (mutation: always org:member -> FAILS)", async () => {
    organizations.createOrganizationInvitation.mockResolvedValue({ id: "orginv_1" });
    await createTeamInvitation({ orgId: "org_1", email: "a@x.com", role: "owner", language: "es", inviterUserId: "user_owner" });
    expect(organizations.createOrganizationInvitation).toHaveBeenCalledWith(expect.objectContaining({
      role: "org:admin", publicMetadata: { bis_role: "owner", bis_language: "es" },
    }));
  });
  it("restoreToOrganization re-adds Staff as org:member, never org:admin (mutation: org:admin -> FAILS)", async () => {
    organizations.createOrganizationMembership.mockResolvedValue({});
    expect(await restoreToOrganization("org_1", "user_1", "staff")).toEqual({ ok: true });
    expect(organizations.createOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", role: "org:member" });
  });
  it("restoreToOrganization re-adds an Owner as org:admin (mutation: always org:member -> FAILS)", async () => {
    organizations.createOrganizationMembership.mockResolvedValue({});
    await restoreToOrganization("org_1", "user_1", "owner");
    expect(organizations.createOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", role: "org:admin" });
  });
  it("setOrganizationRole updates the Clerk membership to follow the BIS role (mutation: swap the mapping -> FAILS)", async () => {
    organizations.updateOrganizationMembership.mockResolvedValue({});
    expect(await setOrganizationRole("org_1", "user_1", "staff")).toEqual({ ok: true });
    expect(organizations.updateOrganizationMembership).toHaveBeenLastCalledWith({ organizationId: "org_1", userId: "user_1", role: "org:member" });
    await setOrganizationRole("org_1", "user_1", "owner");
    expect(organizations.updateOrganizationMembership).toHaveBeenLastCalledWith({ organizationId: "org_1", userId: "user_1", role: "org:admin" });
  });
  it("setOrganizationRole reports a Clerk failure as a result, logged without the address (mutation: throw -> FAILS)", async () => {
    organizations.updateOrganizationMembership.mockRejectedValue(clerkError(500, "internal"));
    expect(await setOrganizationRole("org_1", "user_1", "staff")).toEqual({ ok: false, code: "internal" });
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
});
