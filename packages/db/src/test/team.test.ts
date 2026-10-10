import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { roleFromClerk, languageFromClerk, isAgencyMetadata, reconcileMembership, readAccountRole, setAccountMemberRole, addAccountMember, INVITE_ACCEPT_ALLOWANCE_MS,
         listAccountTeam, type ClerkTeamPort } from "../team";

const RUN = Math.random().toString(36).slice(2, 10);

describe("the pure functions are safe on non-object metadata (malformed metadata)", () => {
  const bad = ["x", 42, ["bis_role"], null] as const;
  it("roleFromClerk falls through to the clerkRole rule, never throws", () => {
    for (const m of bad) {
      expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: m })).toBe("staff");
      expect(roleFromClerk({ clerkRole: "org:admin", invitationMeta: m })).toBe("owner");
    }
  });
  it("languageFromClerk returns null, never throws", () => {
    for (const m of bad) expect(languageFromClerk(m)).toBeNull();
  });
  it("isAgencyMetadata is false, never throws", () => {
    for (const m of bad) expect(isAgencyMetadata(m)).toBe(false);
  });
});

/** A minimal fake SupabaseClient covering only the two single-`.eq()` reads
 *  reconcileMembership's "Clerk says gone" branch makes (`accounts` then
 *  `users`, each `.select().eq().maybeSingle()`), so this proves the bug
 *  without touching any real project. */
function fakeDbWithUserLookupError(): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "accounts") return { data: { id: "acct-fake" }, error: null };
            if (table === "users") return { data: null, error: { message: "boom: users lookup failed" } };
            throw new Error(`fakeDbWithUserLookupError: unexpected table ${table}`);
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("reconcileMembership: a failed read must not read as success", () => {
  it("rejects when the 'Clerk says gone' user lookup errors, instead of resolving removed with nothing deleted (mutation: drop the error check on that lookup -> FAILS)", async () => {
    const port: ClerkTeamPort = {
      getUser: async () => null,
      getMembership: async () => null, // Clerk has no membership -> the "gone" branch
      acceptedInvitationMeta: async () => null,
    };
    await expect(reconcileMembership(fakeDbWithUserLookupError(), port,
      { clerkUserId: "user_fake", clerkOrgId: "org_fake", mode: "webhook" }))
      .rejects.toThrow(/boom: users lookup failed/);
  });
});

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
    getMembership: async () => over.membership === undefined ? { role: "org:member", publicMetadata: {}, createdAt: Date.now() } : over.membership,
    acceptedInvitationMeta: async () => over.invite ?? null,
  };
}

describe("reconcileMembership against the real database", () => {
  it("creates the user and membership with the rule's role, and a replay converges (mutation: upsert membership with update -> role reset, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const sub = `user_rc_${RUN}`;
      try {
        const port = fakePort({ membership: { role: "org:member", publicMetadata: { bis_role: "owner", bis_language: "es" }, createdAt: Date.now() } });
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
      const port = fakePort({ user: { email: "a@example.com", name: null, publicMetadata: { app_role: "agency_admin" } }, membership: { role: "org:admin", publicMetadata: {}, createdAt: Date.now() } });
      expect(await reconcileMembership(db, port, { clerkUserId: `user_ag_${RUN}`, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
        .toEqual({ outcome: "agency_user" });
    }));
});

/**
 * A chainable fake SupabaseClient: every builder method records itself and
 * returns the builder; `maybeSingle()`/`single()` and a bare `await` resolve
 * to `respond(table, ops)`. Enough for reconcile's reads and upserts without
 * touching any real project.
 */
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

describe("addAccountMember: a lost insert race is 'existed', not an error (fake client)", () => {
  it("23505 from the older memberships_unique index reads as existed (mutation: drop the 23505 branch -> FAILS)", async () => {
    const db = chainDb(() => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "memberships_unique"' } }));
    expect(await addAccountMember(db, { accountId: "a", userId: "u", role: "staff" })).toBe("existed");
  });
  it("any other error still throws (mutation: swallow every error -> FAILS)", async () => {
    const db = chainDb(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    await expect(addAccountMember(db, { accountId: "a", userId: "u", role: "staff" })).rejects.toThrow(/addAccountMember failed/);
  });
});

describe("reconcileMembership honours only an invitation accepted for THIS membership (fake client)", () => {
  it("asks for invitations accepted since the membership began, less the allowance (mutation: pass 0 -> FAILS)", async () => {
    const db = chainDb((table, ops) => {
      if (table === "accounts") return { data: { id: "acct" }, error: null };
      if (table === "users") return { data: { id: "u1", language: "en" }, error: null };
      return ops.includes("upsert") ? { data: [{ id: "m1" }], error: null } : { data: null, error: null };
    });
    const created = 1_760_000_000_000;
    const seen: unknown[][] = [];
    const port: ClerkTeamPort = {
      getUser: async () => ({ email: "pat@example.com", name: null, publicMetadata: {} }),
      getMembership: async () => ({ role: "org:member", publicMetadata: {}, createdAt: created }),
      acceptedInvitationMeta: async (...a) => { seen.push(a); return null; },
    };
    expect(await reconcileMembership(db, port, { clerkUserId: "user_1", clerkOrgId: "org_1", mode: "fallback" }))
      .toEqual({ outcome: "created", role: "staff" });
    expect(INVITE_ACCEPT_ALLOWANCE_MS).toBe(10 * 60 * 1000);
    expect(seen).toEqual([["org_1", "pat@example.com", created - INVITE_ACCEPT_ALLOWANCE_MS]]);
  });
});
