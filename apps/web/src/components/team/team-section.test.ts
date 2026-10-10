import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TeamMember } from "@bis/db";

/**
 * TeamSection (server): reads the stored team on the RLS client, Clerk's
 * pending invitations and cap beside it, and binds the Team actions to THIS
 * account. Called, not rendered: it returns one element whose props are the
 * whole contract (settings/sections.test.ts's form).
 */
const fx = vi.hoisted(() => ({
  order: [] as string[],
  account: { language: "es" } as Record<string, unknown> | null,
  listAccountTeam: vi.fn(),
  listPendingInvitations: vi.fn(),
  teamCapacity: vi.fn(),
  acts: {
    inviteTeamMemberAction: vi.fn(async () => ({ ok: true })),
    setTeamRoleAction: vi.fn(async () => ({ ok: true })),
    setTeamLanguageAction: vi.fn(async () => ({ ok: true })),
    removeTeamMemberAction: vi.fn(async () => ({ ok: true })),
    undoRemoveTeamMemberAction: vi.fn(async () => ({ ok: true })),
    revokeTeamInvitationAction: vi.fn(async () => ({ ok: true })),
    undoRevokeTeamInvitationAction: vi.fn(async () => ({ ok: true })),
  },
}));
const RLS = {
  tag: "rls",
  from: (table: string) => {
    fx.order.push(`from:${table}`);
    const c = {
      select: (cols: string) => { fx.order.push(`select:${cols}`); return c; },
      eq: () => c,
      maybeSingle: async () => ({ data: fx.account, error: null }),
    };
    return c;
  },
};
vi.mock("@/lib/db", () => ({ dbForRequest: async () => RLS }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAccountTeam: fx.listAccountTeam,
  serviceDb: () => ({ tag: "service" }),
}));
vi.mock("@/lib/team/clerk-team", () => ({
  listPendingInvitations: fx.listPendingInvitations,
  teamCapacity: fx.teamCapacity,
}));
// A "use server" module: stubbed, never imported into a vitest run.
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/team/actions", () => fx.acts);

const { TeamSection } = await import("./team-section");
const { TeamCard, TeamLoadError } = await import("./team-card");

type Props = Record<string, unknown> & { actions: Record<string, (...a: unknown[]) => Promise<unknown>> };

const ROSA: TeamMember = { userId: "11111111-1111-4111-8111-111111111111", clerkUserId: "user_1", email: "rosa@rio.test", name: "Rosa", role: "owner", language: null };
const INVITE = { id: "orginv_1", email: "new@rio.test", role: "staff", language: "en" };

beforeEach(() => {
  fx.order = [];
  fx.account = { language: "es" };
  fx.listAccountTeam.mockReset().mockResolvedValue([ROSA]);
  fx.listPendingInvitations.mockReset().mockResolvedValue([INVITE]);
  fx.teamCapacity.mockReset().mockResolvedValue({ maxAllowed: 5, members: 2, pending: 1 });
  for (const f of Object.values(fx.acts)) f.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const section = (clerkOrgId: string | null = "org_1") => TeamSection({ accountId: "a1", clerkOrgId, viewer: "owner" });

describe("TeamSection", () => {
  it("passes the stored team (read on the RLS client), Clerk's invitations, and the room left", async () => {
    const el = await section();
    expect(el.type).toBe(TeamCard);
    const p = el.props as Props;
    expect(fx.listAccountTeam).toHaveBeenCalledWith(RLS, "a1");
    expect(p.members).toEqual([ROSA]);
    expect(p.pending).toEqual([INVITE]);
    expect(p.room).toBe(2);
    expect(p.clerkUnavailable).toBe(false);
    expect(p.viewer).toBe("owner");
    expect(fx.listPendingInvitations).toHaveBeenCalledWith("org_1");
    expect(fx.teamCapacity).toHaveBeenCalledWith("org_1");
  });

  it("Clerk rejecting gives clerkUnavailable, and the members still come from listAccountTeam (mutation: return early on the Clerk error -> FAILS)", async () => {
    fx.listPendingInvitations.mockRejectedValue(new Error("listPendingInvitations: 503"));
    const el = await section();
    expect(el.type).toBe(TeamCard);
    const p = el.props as Props;
    expect(p.clerkUnavailable).toBe(true);
    expect(p.members).toEqual([ROSA]);
    expect(p.pending).toEqual([]);
    expect(p.room).toBeNull();
  });

  it("the cap failing alone is Clerk unreachable too (mutation: catch only the invitation read -> FAILS)", async () => {
    fx.teamCapacity.mockRejectedValue(new Error("teamCapacity: 429"));
    const p = (await section()).props as Props;
    expect(p.clerkUnavailable).toBe(true);
    expect(p.members).toEqual([ROSA]);
  });

  it("an account with no organisation never calls Clerk and is not 'unreachable'", async () => {
    const p = (await section(null)).props as Props;
    expect(fx.listPendingInvitations).not.toHaveBeenCalled();
    expect(fx.teamCapacity).not.toHaveBeenCalled();
    expect(p.clerkUnavailable).toBe(false);
    expect(p.room).toBeNull();
  });

  it("reads the account with select(\"*\") and defaults invitations to its language (mutation: name the column -> FAILS)", async () => {
    expect(((await section()).props as Props).defaultLanguage).toBe("es");
    expect(fx.order).toContain("select:*");
    fx.account = {};
    expect(((await section()).props as Props).defaultLanguage).toBe("en");
  });

  it("a failed team read renders the card's own error state instead of taking the page down (mutation: drop the try -> FAILS)", async () => {
    fx.listAccountTeam.mockRejectedValue(new Error("listAccountTeam failed: boom"));
    const el = await section();
    expect(el.type).toBe(TeamLoadError);
  });

  it("binds every action to THIS account, the account id never travelling from the browser (mutation: bind another id -> FAILS)", async () => {
    const { actions } = (await section()).props as Props;
    await actions.remove!("u1");
    expect(fx.acts.removeTeamMemberAction).toHaveBeenCalledWith("a1", "u1");
    await actions.undoRemove!("u1");
    expect(fx.acts.undoRemoveTeamMemberAction).toHaveBeenCalledWith("a1", "u1");
    await actions.setRole!("u1", "staff");
    expect(fx.acts.setTeamRoleAction).toHaveBeenCalledWith("a1", "u1", "staff");
    await actions.setLanguage!("u1", null);
    expect(fx.acts.setTeamLanguageAction).toHaveBeenCalledWith("a1", "u1", null);
    await actions.revoke!("orginv_1");
    expect(fx.acts.revokeTeamInvitationAction).toHaveBeenCalledWith("a1", "orginv_1");
    await actions.undoRevoke!("x@rio.test", "staff", "en");
    expect(fx.acts.undoRevokeTeamInvitationAction).toHaveBeenCalledWith("a1", "x@rio.test", "staff", "en");
    const f = new FormData();
    await actions.invite!(f);
    expect(fx.acts.inviteTeamMemberAction).toHaveBeenCalledWith("a1", f);
  });
});
