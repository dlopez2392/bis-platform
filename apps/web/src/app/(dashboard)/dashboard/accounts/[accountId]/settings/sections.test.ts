import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

/**
 * The two Settings cards that read a third party, streamed in their own
 * <Suspense> (page.test.ts pins the mounts). Called, not rendered: each
 * returns one element whose props are the whole contract.
 */
const fx = vi.hoisted(() => ({
  clerkCalls: 0,
  memberships: vi.fn(),
  invitations: vi.fn(),
  listProjects: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => {
    fx.clerkCalls += 1;
    return {
      organizations: {
        getOrganizationMembershipList: fx.memberships,
        getOrganizationInvitationList: fx.invitations,
      },
    };
  },
}));
vi.mock("@/lib/vercel/web-analytics", () => ({
  vercelAnalyticsFromEnv: () => ({ listProjects: fx.listProjects }),
}));

// "use server" modules — stubbed, never imported into a vitest run.
const noop = async () => ({ ok: true });
vi.mock("./actions", () => ({ setClientAccessAction: noop, inviteClientAdminAction: noop }));
vi.mock("../website/actions", () => ({
  saveSiteAction: noop, testSiteConnectionAction: noop, unlinkSiteAction: noop,
}));

const { ClientAccessSection } = await import("./client-access-section");
const { WebsiteSection } = await import("./website-section");
const { ClientAccessPanel, ClientAccessSkeleton } = await import("./client-access-panel");
const { LinkSiteCard, LinkSiteSkeleton } = await import("../website/link-site-card");

type Props = Record<string, unknown>;

beforeEach(() => {
  fx.clerkCalls = 0;
  fx.memberships.mockReset();
  fx.invitations.mockReset();
  fx.listProjects.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ClientAccessSection", () => {
  it("lists members and pending invites from Clerk, roles without the org: prefix", async () => {
    fx.memberships.mockResolvedValue({ data: [
      { id: "mem_1", role: "org:admin", publicUserData: { identifier: "owner@rio.test" } },
    ] });
    fx.invitations.mockResolvedValue({ data: [
      { id: "inv_1", role: "org:member", emailAddress: "new@rio.test" },
    ] });
    const el = await ClientAccessSection({ accountId: "a1", clerkOrgId: "org_1", enabled: true });
    expect(el.type).toBe(ClientAccessPanel);
    const props = el.props as Props;
    expect(props.enabled).toBe(true);
    expect(props.members).toEqual([{ id: "mem_1", email: "owner@rio.test", role: "Admin" }]);
    expect(props.pendingInvites).toEqual([{ id: "inv_1", email: "new@rio.test", role: "Member" }]);
    expect(props.membersUnavailable).toBe(false);
    expect(fx.invitations).toHaveBeenCalledWith({ organizationId: "org_1", status: ["pending"] });
  });

  it("fails SOFT when Clerk errors: the switch still renders, the list says it is unavailable (mutation: drop the try → FAILS)", async () => {
    fx.memberships.mockRejectedValue(new Error("clerk 429"));
    const el = await ClientAccessSection({ accountId: "a1", clerkOrgId: "org_1", enabled: false });
    expect(el.type).toBe(ClientAccessPanel);
    expect((el.props as Props).membersUnavailable).toBe(true);
    expect((el.props as Props).members).toEqual([]);
  });

  it("does not call Clerk at all for an account with no organization", async () => {
    const el = await ClientAccessSection({ accountId: "a1", clerkOrgId: null, enabled: false });
    expect(fx.clerkCalls).toBe(0);
    expect((el.props as Props).membersUnavailable).toBe(false);
  });
});

describe("WebsiteSection", () => {
  it("passes Vercel's projects and the page's linked site through", async () => {
    fx.listProjects.mockResolvedValue([{ id: "prj_1", name: "rio-site" }]);
    const linked = { vercelProjectId: "prj_1", domain: "rio.test" };
    const el = await WebsiteSection({ accountId: "a1", linked, daysStored: 12 });
    expect(el.type).toBe(LinkSiteCard);
    expect(el.key).toBe("a1");
    const props = el.props as Props;
    expect(props.projects).toEqual([{ id: "prj_1", name: "rio-site" }]);
    expect(props.projectsUnavailable).toBe(false);
    expect(props.linked).toEqual(linked);
    expect(props.daysStored).toBe(12);
  });

  it("fails SOFT when Vercel errors or the token is unset (mutation: drop the try → FAILS)", async () => {
    fx.listProjects.mockRejectedValue(new Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset"));
    const el = await WebsiteSection({ accountId: "a1", linked: null, daysStored: 0 });
    expect((el.props as Props).projectsUnavailable).toBe(true);
    expect((el.props as Props).projects).toEqual([]);
  });
});

/**
 * The hash scroll runs ONCE, on the page's first commit, which is while these
 * skeletons are showing. A skeleton without its card's id turns the palette's
 * jump to that card into a jump to the top of the page.
 */
describe("the streamed cards' skeletons keep their palette anchors", () => {
  it.each([
    ["client-access", () => ClientAccessSkeleton()],
    ["website", () => LinkSiteSkeleton({ linkedDomain: null })],
  ])("#%s (mutation: drop the id from the skeleton → FAILS)", (anchor, render) => {
    const el = render() as ReactElement<Props>;
    expect(isValidElement(el)).toBe(true);
    expect(el.props.id).toBe(anchor);
    expect(el.props["aria-busy"]).toBe("true");
  });
});
