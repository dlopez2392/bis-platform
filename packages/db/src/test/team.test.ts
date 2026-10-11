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
  it("metadata and Clerk role agreeing on Owner is Owner, from either metadata source", () => {
    expect(roleFromClerk({ clerkRole: "org:admin", membershipMeta: { bis_role: "owner" } })).toBe("owner");
    expect(roleFromClerk({ clerkRole: "org:admin", invitationMeta: { bis_role: "owner" } })).toBe("owner");
  });
  it("metadata bis_role owner beside a Clerk org:member is the LESS privileged, staff (review I4; mutation: metadata wins -> FAILS)", () => {
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "owner" } })).toBe("staff");
    expect(roleFromClerk({ clerkRole: "org:member", invitationMeta: { bis_role: "owner" } })).toBe("staff");
  });
  it("either metadata source saying staff beside org:admin is staff (review I4; mutation: consult the membership metadata only -> FAILS)", () =>
    expect(roleFromClerk({ clerkRole: "org:admin", membershipMeta: { bis_role: "owner" }, invitationMeta: { bis_role: "staff" } })).toBe("staff"));
  it("org:admin with no metadata is owner (every existing client login)", () =>
    expect(roleFromClerk({ clerkRole: "org:admin" })).toBe("owner"));
  it("anything else is staff, including a garbage bis_role (mutation: default to owner -> FAILS)", () => {
    expect(roleFromClerk({ clerkRole: "org:member" })).toBe("staff");
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "admin" } })).toBe("staff");
  });
  it("languageFromClerk takes the first valid en|es and ignores others", () =>
    expect(languageFromClerk({ bis_language: "fr" }, { bis_language: "es" })).toBe("es"));
});

describe("roleFromClerk: a technician bis_role is honoured and can only lower (spec §6)", () => {
  it("org:member + bis_role technician -> technician (mutation: drop 'technician' from ROLES -> FAILS with staff)", () => {
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "technician" } })).toBe("technician");
  });
  it("org:admin + an invitation that said technician -> technician, never owner or staff (mutation: answers.every(owner) ? owner : staff -> FAILS)", () => {
    expect(roleFromClerk({ clerkRole: "org:admin", invitationMeta: { bis_role: "technician" } })).toBe("technician");
  });
  it("staff metadata beside technician metadata -> technician", () => {
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "staff" }, invitationMeta: { bis_role: "technician" } })).toBe("technician");
  });
  it("no metadata keeps the old rule", () => {
    expect(roleFromClerk({ clerkRole: "org:admin" })).toBe("owner");
    expect(roleFromClerk({ clerkRole: "org:member" })).toBe("staff");
  });
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
        const port = fakePort({ membership: { role: "org:admin", publicMetadata: { bis_role: "owner", bis_language: "es" }, createdAt: Date.now() } });
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
  // The users row is deleted AFTER withTestAccount's teardown, not inside it: contacts.assigned_to
  // references users with no delete action (0003), so under the mutation (release skipped) a delete
  // inside the callback would fail on the FK and strand the users row.
  it("a webhook removal sends the removed person's customers back to Unassigned (owner ruling A3; mutation: skip the release call -> FAILS)", async () => {
    const sub = `user_rmrel_${RUN}`;
    try {
      await withTestAccount(async (db, accountId) => {
        const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
        expect(await reconcileMembership(db, fakePort({}), { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "created", role: "staff" });
        const { data: u, error: uErr } = await db.from("users").select("id").eq("clerk_user_id", sub).single();
        if (uErr) throw uErr;
        const { data: c, error: cErr } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: "Held", assigned_to: u.id }).select("id").single();
        if (cErr) throw cErr;
        expect(await reconcileMembership(db, fakePort({ membership: null }), { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "removed" });
        const { data: after, error: aErr } = await db.from("contacts").select("assigned_to").eq("id", c.id).single();
        if (aErr) throw aErr;
        expect(after.assigned_to).toBeNull();
      });
    } finally {
      const { error } = await serviceDb().from("users").delete().eq("clerk_user_id", sub);
      if (error) throw new Error(`team.test cleanup failed on users: ${error.message}`);
    }
  });
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
    expect(INVITE_ACCEPT_ALLOWANCE_MS).toBe(60 * 1000);
    expect(seen).toEqual([["org_1", "pat@example.com", created - INVITE_ACCEPT_ALLOWANCE_MS]]);
  });
});

/** A fake that records each builder call WITH its arguments, so a query's filters can be asserted. */
function recordingDb(respond: (table: string, calls: [string, unknown[]][]) => { data: unknown; error: unknown }) {
  const queries: { table: string; calls: [string, unknown[]][] }[] = [];
  const db = {
    from(table: string) {
      const q = { table, calls: [] as [string, unknown[]][] };
      queries.push(q);
      const b: Record<string | symbol, unknown> = new Proxy({}, {
        get(_t, k) {
          if (k === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(table, q.calls)).then(res, rej);
          if (k === "maybeSingle" || k === "single") return async () => respond(table, [...q.calls, [String(k), []]]);
          return (...a: unknown[]) => { q.calls.push([String(k), a]); return b; };
        },
      });
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, queries };
}

describe("reconcileMembership never recreates a membership removed AFTER the Clerk membership began (review I3)", () => {
  const created = 1_760_000_000_000;
  const port: ClerkTeamPort = {
    getUser: async () => ({ email: "pat@example.com", name: null, publicMetadata: {} }),
    getMembership: async () => ({ role: "org:admin", publicMetadata: {}, createdAt: created }),
    acceptedInvitationMeta: async () => null,
  };
  function world(removalEvent: boolean) {
    return recordingDb((table, calls) => {
      if (table === "accounts") return { data: { id: "acct" }, error: null };
      if (table === "events") return { data: removalEvent ? { id: 9 } : null, error: null };
      if (table === "users") return { data: { id: "u1", language: "en" }, error: null };
      return calls.some(([k]) => k === "upsert") ? { data: [{ id: "m1" }], error: null } : { data: null, error: null };
    });
  }
  it.each(["fallback", "webhook"] as const)("%s: a system team.member_removed newer than the membership refuses, and nothing is written (mutation: drop the removal check -> FAILS)", async (mode) => {
    const { db, queries } = world(true);
    expect(await reconcileMembership(db, port, { clerkUserId: "user_1", clerkOrgId: "org_1", mode })).toEqual({ outcome: "stale" });
    expect(queries.some((q) => q.calls.some(([k]) => k === "upsert"))).toBe(false);
  });
  it("asks only for THIS account's system-written removals of THIS Clerk user, newer than the membership (mutation: drop the actor_type filter -> FAILS)", async () => {
    const { db, queries } = world(false);
    expect(await reconcileMembership(db, port, { clerkUserId: "user_1", clerkOrgId: "org_1", mode: "fallback" }))
      .toEqual({ outcome: "created", role: "owner" });
    const ev = queries.find((q) => q.table === "events")!;
    expect(ev.calls).toEqual(expect.arrayContaining([
      ["eq", ["account_id", "acct"]], ["eq", ["type", "team.member_removed"]], ["eq", ["actor_type", "system"]],
      ["eq", ["payload->>clerkUserId", "user_1"]], ["gt", ["created_at", new Date(created).toISOString()]],
    ]));
  });
  it("a failed removal read throws rather than reading as 'no removal' (mutation: ignore the error -> FAILS)", async () => {
    const { db } = recordingDb((table) => table === "accounts" ? { data: { id: "acct" }, error: null }
      : table === "events" ? { data: null, error: { message: "down" } } : { data: null, error: null });
    await expect(reconcileMembership(db, port, { clerkUserId: "user_1", clerkOrgId: "org_1", mode: "fallback" })).rejects.toThrow(/removal/);
  });
});

describe("agency users stay out of every team even once they have a users row (mis preferencias D2)", () => {
  it("reconcileMembership returns agency_user and leaves the agency row's preferences and membership count alone (mutation: move the isAgencyMetadata check below upsertUserFromClerk -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: acct } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const sub = `user_prefs_agency_team_${RUN}`;
      try {
        const { data: u } = await db.from("users")
          .insert({ clerk_user_id: sub, email: `${sub}@example.com`, name: "Stored Name", theme: "dark", language: null })
          .select("id").single();
        // Final fix wave, M-b: Clerk reports a DIFFERENT email and name and a
        // bis_language, and the stored language is NULL, so an upsert that ran
        // before the agency check would visibly change this row (email, name
        // and language). With the old seed (same email, no name, language
        // already set) the upsert was a no-op and the mutation survived.
        const port = fakePort({
          user: { email: `${sub}-clerk@example.com`, name: "Clerk Name", publicMetadata: { app_role: "agency_admin" } },
          membership: { role: "org:admin", publicMetadata: { bis_language: "en" }, createdAt: Date.now() },
        });
        expect(await reconcileMembership(db, port, { clerkUserId: sub, clerkOrgId: acct!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "agency_user" });
        const { count } = await db.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", u!.id);
        expect(count).toBe(0);
        const { data: row } = await db.from("users").select("email, name, theme, language").eq("id", u!.id).single();
        expect(row).toEqual({ email: `${sub}@example.com`, name: "Stored Name", theme: "dark", language: null });
      } finally {
        await serviceDb().from("users").delete().eq("clerk_user_id", sub);
      }
    });
  });
});
