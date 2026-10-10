import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { roleFromClerk, languageFromClerk, reconcileMembership, readAccountRole, setAccountMemberRole,
         listAccountTeam, type ClerkTeamPort } from "../team";

const RUN = Math.random().toString(36).slice(2, 10);

describe("roleFromClerk: the three sources, in order (spec §6)", () => {
  it("invitation bis_role on the membership wins over the Clerk role (mutation: check clerkRole first -> FAILS)", () =>
    expect(roleFromClerk({ clerkRole: "org:admin", membershipMeta: { bis_role: "staff" } })).toBe("staff"));
  it("then the accepted invitation's metadata", () =>
    expect(roleFromClerk({ clerkRole: "org:member", invitationMeta: { bis_role: "owner" } })).toBe("owner"));
  it("org:admin with no metadata is owner (every existing client login)", () =>
    expect(roleFromClerk({ clerkRole: "org:admin" })).toBe("owner"));
  it("anything else is staff, including a garbage bis_role (mutation: default to owner -> FAILS)", () => {
    expect(roleFromClerk({ clerkRole: "org:member" })).toBe("staff");
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "admin" } })).toBe("staff");
  });
  it("languageFromClerk takes the first valid en|es and ignores others", () =>
    expect(languageFromClerk({ bis_language: "fr" }, { bis_language: "es" })).toBe("es"));
});

function fakePort(over: Partial<{ user: Awaited<ReturnType<ClerkTeamPort["getUser"]>>; membership: Awaited<ReturnType<ClerkTeamPort["getMembership"]>>; invite: unknown }>): ClerkTeamPort {
  return {
    getUser: async () => over.user === undefined ? { email: `p-${RUN}@example.com`, name: "Pat", publicMetadata: {} } : over.user,
    getMembership: async () => over.membership === undefined ? { role: "org:member", publicMetadata: {} } : over.membership,
    acceptedInvitationMeta: async () => over.invite ?? null,
  };
}

describe("reconcileMembership against the real database", () => {
  it("creates the user and membership with the rule's role, and a replay converges (mutation: upsert membership with update -> role reset, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const sub = `user_rc_${RUN}`;
      try {
        const port = fakePort({ membership: { role: "org:member", publicMetadata: { bis_role: "owner", bis_language: "es" } } });
        expect(await reconcileMembership(db, port, { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "created", role: "owner" });
        const team = await listAccountTeam(db, accountId);
        expect(team).toMatchObject([{ clerkUserId: sub, role: "owner", language: "es" }]);
        // The only Owner cannot be demoted (the guard); and a later BIS role change must survive a replayed created event.
        expect(await setAccountMemberRole(db, accountId, team[0]!.userId, "staff")).toBe("last_owner");
        await db.from("memberships").update({ role: "staff" }).eq("account_id", accountId).eq("user_id", team[0]!.userId);
        expect(await reconcileMembership(db, port, { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "exists", role: "staff" });
      } finally { await serviceDb().from("users").delete().eq("clerk_user_id", sub); }
    }));
  it("a membership Clerk no longer has is removed on a webhook replay, never resurrected (mutation: apply the payload instead of re-reading -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const sub = `user_rm_${RUN}`;
      try {
        await reconcileMembership(db, fakePort({}), { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" });
        expect(await reconcileMembership(db, fakePort({ membership: null }), { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "removed" });
        expect(await readAccountRole(db, accountId, sub)).toBeNull();
      } finally { await serviceDb().from("users").delete().eq("clerk_user_id", sub); }
    }));
  it("an org with no accounts row is ignored and writes nothing", () =>
    withTestAccount(async (db) => {
      expect(await reconcileMembership(db, fakePort({}), { clerkUserId: `user_x_${RUN}`, clerkOrgId: `org_nobody_${RUN}`, mode: "webhook" }))
        .toEqual({ outcome: "no_account" });
      expect((await db.from("users").select("id").eq("clerk_user_id", `user_x_${RUN}`)).data).toEqual([]);
    }));
  it("an agency user is never made a member (mutation: drop the isAgencyMetadata check -> FAILS with created/owner)", () =>
    withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const port = fakePort({ user: { email: "a@example.com", name: null, publicMetadata: { app_role: "agency_admin" } }, membership: { role: "org:admin", publicMetadata: {} } });
      expect(await reconcileMembership(db, port, { clerkUserId: `user_ag_${RUN}`, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
        .toEqual({ outcome: "agency_user" });
    }));
});
