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
  updateOrganizationMembershipMetadata: vi.fn(),
};
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users, organizations }) }));

import { reconcileMembership, type SupabaseClient } from "@bis/db";
import {
  liveClerkTeamPort, listPendingInvitations, teamCapacity, createTeamInvitation,
  revokeTeamInvitation, removeFromOrganization, restoreToOrganization, setOrganizationRole,
  reassertClerkRole, clerkRefused, CLERK_WRITE_TIMEOUT_MS,
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
  // Pat was invited as Staff and accepted 400 days ago, later removed, and is
  // now re-added directly as org:admin (Clerk's dashboard, or the Team undo).
  // Since review I4 an invitation's bis_role can only DEMOTE (roleFromClerk
  // takes the less privileged), so the binding is proven with a Staff one.
  function settle(invite: { createdAt: number; updatedAt: number }) {
    users.getUser.mockResolvedValue({ primaryEmailAddress: { emailAddress: "pat@example.com" }, fullName: "Pat", publicMetadata: {} });
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [
      { role: "org:admin", publicMetadata: {}, createdAt: NOW, organization: { id: "org_1" }, publicUserData: { userId: "user_1" } },
    ], totalCount: 1 });
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { emailAddress: "pat@example.com", ...invite, publicMetadata: { bis_role: "staff" } },
    ], totalCount: 1 });
    const db = chainDb((table, ops) => {
      if (table === "accounts") return { data: { id: "acct" }, error: null };
      if (table === "users") return { data: { id: "u1", language: "en" }, error: null };
      return ops.includes("upsert") ? { data: [{ id: "m1" }], error: null } : { data: null, error: null };
    });
    return reconcileMembership(db, liveClerkTeamPort(), { clerkUserId: "user_1", clerkOrgId: "org_1", mode: "fallback" });
  }
  it("the old Staff invitation is ignored: Pat comes back as the org:admin's Owner (mutation: reconcile passes acceptedSince 0 -> FAILS)", async () => {
    expect(await settle({ createdAt: NOW - 401 * DAY, updatedAt: NOW - 400 * DAY })).toEqual({ outcome: "created", role: "owner" });
  });
  it("an invitation accepted for this membership is honoured: its Staff outranks org:admin (mutation: never honour an invitation -> FAILS)", async () => {
    expect(await settle({ createdAt: NOW - 2 * DAY, updatedAt: NOW - 60 * 1000 })).toEqual({ outcome: "created", role: "staff" });
  });
});

describe("the Team's Clerk calls", () => {
  it("listPendingInvitations maps role and language from the invitation's own metadata", async () => {
    organizations.getOrganizationInvitationList.mockResolvedValue({ data: [
      { id: "orginv_1", emailAddress: "a@x.com", role: "org:admin", publicMetadata: { bis_role: "owner", bis_language: "es" } },
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
      .toEqual({ ok: false, code: "duplicate_record", status: 422 });
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
  it("revokeTeamInvitation returns what an undo needs", async () => {
    organizations.revokeOrganizationInvitation.mockResolvedValue({
      id: "orginv_1", emailAddress: "a@x.com", role: "org:admin", publicMetadata: { bis_role: "owner", bis_language: "es" },
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
    expect(await removeFromOrganization("org_1", "user_1")).toEqual({ ok: false, code: "internal", status: 500 });
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
  // Final review I-1: Clerk's createOrganizationMembership takes no metadata
  // (@clerk/backend 3.13.1 OrganizationApi.d.ts:140-147), and a Technician is
  // org:member like Staff, so only `bis_role` says Technician. A restored
  // membership without it reconciles as Staff.
  it("restoreToOrganization writes the restored role as the membership's bis_role, after the membership exists (mutation: skip the metadata write -> FAILS)", async () => {
    organizations.createOrganizationMembership.mockResolvedValue({});
    organizations.updateOrganizationMembershipMetadata.mockResolvedValue({});
    expect(await restoreToOrganization("org_1", "user_1", "technician")).toEqual({ ok: true });
    expect(organizations.createOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", role: "org:member" });
    expect(organizations.updateOrganizationMembershipMetadata).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", publicMetadata: { bis_role: "technician" } });
    expect(organizations.createOrganizationMembership.mock.invocationCallOrder[0]!)
      .toBeLessThan(organizations.updateOrganizationMembershipMetadata.mock.invocationCallOrder[0]!);
  });
  it("a restored Technician whose bis_role could not be written is taken out of Clerk again and the restore fails, so no bare org:member reads as Staff (mutation: log and report ok -> FAILS)", async () => {
    organizations.createOrganizationMembership.mockResolvedValue({});
    organizations.updateOrganizationMembershipMetadata.mockRejectedValue(clerkError(500, "internal"));
    organizations.deleteOrganizationMembership.mockResolvedValue({});
    expect(await restoreToOrganization("org_1", "user_1", "technician")).toEqual({ ok: false, code: "internal", status: 500 });
    expect(organizations.deleteOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1" });
  });
  it("a Technician restore whose take-back also fails is logged by id as a bare membership (mutation: skip the log -> FAILS)", async () => {
    organizations.createOrganizationMembership.mockResolvedValue({});
    organizations.updateOrganizationMembershipMetadata.mockRejectedValue(clerkError(500, "internal"));
    organizations.deleteOrganizationMembership.mockRejectedValue(clerkError(503, "unavailable"));
    expect((await restoreToOrganization("org_1", "user_1", "technician")).ok).toBe(false);
    expect(String(vi.mocked(console.error).mock.calls.flat())).toMatch(/bis_role[^]*org_1[^]*user_1/);
  });
  it.each(["staff", "owner"] as const)("a %s restore keeps its membership when only the metadata write fails: its Clerk role alone already gives that role (mutation: take every restore back -> FAILS)", async (role) => {
    organizations.createOrganizationMembership.mockResolvedValue({});
    organizations.updateOrganizationMembershipMetadata.mockRejectedValue(clerkError(500, "internal"));
    expect(await restoreToOrganization("org_1", "user_1", role)).toEqual({ ok: true });
    expect(organizations.deleteOrganizationMembership).not.toHaveBeenCalled();
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
    expect(await setOrganizationRole("org_1", "user_1", "staff")).toEqual({ ok: false, code: "internal", status: 500 });
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
});

describe("a role change keeps the membership's bis_role metadata in step (review I4)", () => {
  // updateOrganizationMembershipMetadata({ organizationId, userId, publicMetadata }):
  // @clerk/backend 3.13.1 dist/api/endpoints/OrganizationApi.d.ts:349, params at :151-156.
  it.each(["staff", "owner"] as const)("setOrganizationRole(%s) also writes bis_role to the membership's public metadata (mutation: skip the metadata write -> FAILS)", async (role) => {
    organizations.updateOrganizationMembership.mockResolvedValue({});
    organizations.updateOrganizationMembershipMetadata.mockResolvedValue({});
    expect(await setOrganizationRole("org_1", "user_1", role)).toEqual({ ok: true });
    expect(organizations.updateOrganizationMembershipMetadata).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", publicMetadata: { bis_role: role } });
  });
  it("the metadata write follows a role write that landed; a role write that failed writes no metadata (mutation: metadata first -> FAILS)", async () => {
    organizations.updateOrganizationMembership.mockRejectedValue(clerkError(422, "form_param_value_invalid"));
    expect(await setOrganizationRole("org_1", "user_1", "owner")).toEqual({ ok: false, code: "form_param_value_invalid", status: 422 });
    expect(organizations.updateOrganizationMembershipMetadata).not.toHaveBeenCalled();
  });
  // Final review I-1: Technician and Staff share org:member, so a demotion
  // to Technician whose bis_role did not land reads as Staff. Stale metadata
  // demotes only between Owner and Staff; Technician needs it to stand.
  it("a move to Technician whose metadata write fails is a FAILURE, so the caller puts Clerk back (mutation: log and report ok -> FAILS)", async () => {
    organizations.updateOrganizationMembership.mockResolvedValue({});
    organizations.updateOrganizationMembershipMetadata.mockRejectedValue(clerkError(500, "internal"));
    expect(await setOrganizationRole("org_1", "user_1", "technician")).toEqual({ ok: false, code: "internal", status: 500 });
  });
  it("a metadata write that fails after the role landed is logged by id and the role change still stands for Owner or Staff, whose Clerk role alone is never more privileged than BIS (mutation: report it as a failure -> FAILS)", async () => {
    organizations.updateOrganizationMembership.mockResolvedValue({});
    organizations.updateOrganizationMembershipMetadata.mockRejectedValue(clerkError(500, "internal"));
    expect(await setOrganizationRole("org_1", "user_1", "owner")).toEqual({ ok: true });
    expect(String(vi.mocked(console.error).mock.calls.flat())).toContain("user_1");
  });
});

describe("clerkRefused: only a definitive 4xx says the write did not land (review I1)", () => {
  it("4xx is a refusal; 5xx, 408, a timeout and a network error (no status) are 'may have landed' (mutation: any failure is a refusal -> FAILS)", async () => {
    expect(clerkRefused({ ok: false, code: "x", status: 422 })).toBe(true);
    expect(clerkRefused({ ok: false, code: "x", status: 403 })).toBe(true);
    for (const status of [500, 502, 504, 408, null]) expect(clerkRefused({ ok: false, code: "x", status })).toBe(false);
  });
  it("a network error reaching Clerk reports no status (mutation: default the status to 400 -> FAILS)", async () => {
    organizations.updateOrganizationMembership.mockRejectedValue(new TypeError("fetch failed"));
    expect(await setOrganizationRole("org_1", "user_1", "owner")).toEqual({ ok: false, code: null, status: null });
  });
});

describe("reassertClerkRole: Clerk follows the BIS role, writing only what disagrees (review I2)", () => {
  const member = (role: string, publicMetadata: unknown) => organizations.getOrganizationMembershipList.mockResolvedValue({ data: [
    { role, publicMetadata, createdAt: 1, organization: { id: "org_1" }, publicUserData: { userId: "user_1" } }], totalCount: 1 });
  it("Clerk org:admin beside BIS staff is set back to org:member (mutation: never write the role -> FAILS)", async () => {
    member("org:admin", { bis_role: "staff" });
    expect(await reassertClerkRole("org_1", "user_1", "staff")).toEqual({ ok: true, changed: true });
    expect(organizations.updateOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", role: "org:member" });
    expect(organizations.updateOrganizationMembershipMetadata).not.toHaveBeenCalled();
  });
  it("stale metadata alone is rewritten without touching the role", async () => {
    member("org:member", { bis_role: "owner", bis_language: "es" });
    expect(await reassertClerkRole("org_1", "user_1", "staff")).toEqual({ ok: true, changed: true });
    expect(organizations.updateOrganizationMembership).not.toHaveBeenCalled();
    expect(organizations.updateOrganizationMembershipMetadata).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", publicMetadata: { bis_role: "staff" } });
  });
  it("already in step: no write at all, so the updated event it would fire cannot loop (mutation: always write -> FAILS)", async () => {
    member("org:admin", { bis_role: "owner" });
    expect(await reassertClerkRole("org_1", "user_1", "owner")).toEqual({ ok: true, changed: false });
    expect(organizations.updateOrganizationMembership).not.toHaveBeenCalled();
    expect(organizations.updateOrganizationMembershipMetadata).not.toHaveBeenCalled();
  });
  it("no Clerk membership: nothing to assert", async () => {
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [], totalCount: 0 });
    expect(await reassertClerkRole("org_1", "user_1", "owner")).toEqual({ ok: true, changed: false });
  });
  it("a failed role write or Clerk read is a failure result, for the webhook to retry (mutation: swallow -> FAILS)", async () => {
    member("org:admin", {});
    organizations.updateOrganizationMembership.mockRejectedValue(clerkError(500, "internal"));
    expect(await reassertClerkRole("org_1", "user_1", "staff")).toEqual({ ok: false, code: "internal", status: 500 });
    organizations.getOrganizationMembershipList.mockRejectedValue(clerkError(503, "unavailable"));
    expect(await reassertClerkRole("org_1", "user_1", "staff")).toEqual({ ok: false, code: "unavailable", status: 503 });
  });
});

describe("Clerk not-found on removal, and a bound on every Clerk write", () => {
  it("removeFromOrganization: Clerk answering 404 means the member is already gone, which is success (mutation: treat 404 as failure -> FAILS)", async () => {
    // @clerk/shared 4.25.8 dist/errors/clerkApiResponseError.d.ts:13,16: `status: number`, `errors: ClerkAPIError[]`.
    organizations.deleteOrganizationMembership.mockRejectedValue(clerkError(404, "resource_not_found"));
    expect(await removeFromOrganization("org_1", "user_1")).toEqual({ ok: true });
  });
  it("removeFromOrganization: any other refusal is still a failure", async () => {
    organizations.deleteOrganizationMembership.mockRejectedValue(clerkError(403, "not_allowed"));
    expect(await removeFromOrganization("org_1", "user_1")).toEqual({ ok: false, code: "not_allowed", status: 403 });
  });

  const never = () => new Promise(() => {});
  const writes: [string, () => void, () => Promise<unknown>][] = [
    ["createTeamInvitation", () => organizations.createOrganizationInvitation.mockReturnValue(never()),
      () => createTeamInvitation({ orgId: "org_1", email: "a@x.com", role: "staff", language: "en", inviterUserId: "u" })],
    ["revokeTeamInvitation", () => organizations.revokeOrganizationInvitation.mockReturnValue(never()), () => revokeTeamInvitation("org_1", "orginv_1")],
    ["removeFromOrganization", () => organizations.deleteOrganizationMembership.mockReturnValue(never()), () => removeFromOrganization("org_1", "user_1")],
    ["restoreToOrganization", () => organizations.createOrganizationMembership.mockReturnValue(never()), () => restoreToOrganization("org_1", "user_1", "staff")],
    ["setOrganizationRole", () => organizations.updateOrganizationMembership.mockReturnValue(never()), () => setOrganizationRole("org_1", "user_1", "staff")],
  ];
  it.each(writes)("%s gives up after CLERK_WRITE_TIMEOUT_MS with code 'timeout' (mutation: no timeout on this write -> FAILS)", async (_n, arrange, call) => {
    vi.useFakeTimers();
    try {
      arrange();
      const p = call();
      await vi.advanceTimersByTimeAsync(CLERK_WRITE_TIMEOUT_MS);
      await expect(p).resolves.toEqual({ ok: false, code: "timeout", status: null });
    } finally {
      vi.useRealTimers();
    }
  });
  it("the bound is about 5 s, and a write answering inside it is waited for (mutation: a much shorter bound -> FAILS)", async () => {
    expect(CLERK_WRITE_TIMEOUT_MS).toBe(5000);
    vi.useFakeTimers();
    try {
      organizations.updateOrganizationMembership.mockReturnValue(new Promise((res) => setTimeout(() => res({}), CLERK_WRITE_TIMEOUT_MS - 100)));
      const p = setOrganizationRole("org_1", "user_1", "owner");
      await vi.advanceTimersByTimeAsync(CLERK_WRITE_TIMEOUT_MS);
      await expect(p).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
