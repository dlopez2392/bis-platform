import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
vi.mock("./actions", () => ({ setClientAccessAction: noop }));
const team = vi.hoisted(() => ({ TeamSection: () => null }));
vi.mock("@/components/team/team-section", () => team);
vi.mock("../website/actions", () => ({
  saveSiteAction: noop, testSiteConnectionAction: noop, unlinkSiteAction: noop,
}));

const { ClientAccessSection } = await import("./client-access-section");
const { WebsiteSection } = await import("./website-section");
const { ClientAccessPanel, ClientAccessSkeleton } = await import("./client-access-panel");
const { LinkSiteCard, LinkSiteSkeleton } = await import("../website/link-site-card");
const { TeamSkeleton } = await import("@/components/team/team-card");

const here = path.dirname(fileURLToPath(import.meta.url));
function all(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...all(el.props.children as ReactNode)];
}

type Props = Record<string, unknown>;

beforeEach(() => {
  fx.clerkCalls = 0;
  fx.memberships.mockReset();
  fx.invitations.mockReset();
  fx.listProjects.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * Staff and roles (Task 10): the Client access card keeps only its switch,
 * and the Team card (the same one a client Owner sees on /team) sits under
 * it while access is on. The live Clerk member list and the agency-only
 * invite left with that swap; TeamSection reads the team now.
 */
describe("ClientAccessSection", () => {
  it("renders the switch, and under it the Team card for THIS account in its own Suspense with the shared skeleton (mutation: drop the Team mount -> FAILS)", async () => {
    const els = all(await ClientAccessSection({ accountId: "a1", enabled: true }));
    const panelEl = els.find((e) => e.type === ClientAccessPanel);
    expect(panelEl?.props.enabled).toBe(true);
    const boundary = els.find((e) => e.type === Suspense);
    expect(boundary, "TeamSection inside <Suspense>").toBeTruthy();
    const child = boundary!.props.children as ReactElement<Props>;
    expect(child.type).toBe(team.TeamSection);
    expect(child.props).toEqual({ accountId: "a1", viewer: "agency" });
    const fallback = boundary!.props.fallback as ReactElement;
    expect(isValidElement(fallback) && fallback.type).toBe(TeamSkeleton);
    expect(els.indexOf(panelEl!)).toBeLessThan(els.indexOf(boundary!));
  });

  it("shows no Team card while client access is off (spec §8: shown only while access is on) (mutation: render it always -> FAILS)", async () => {
    const els = all(await ClientAccessSection({ accountId: "a1", enabled: false }));
    expect(els.find((e) => e.type === ClientAccessPanel)?.props.enabled).toBe(false);
    expect(els.some((e) => e.type === team.TeamSection)).toBe(false);
  });

  it("no longer reads Clerk itself: the switch never waits on a member list (mutation: keep the live list -> FAILS)", async () => {
    await ClientAccessSection({ accountId: "a1", enabled: true });
    expect(fx.clerkCalls).toBe(0);
    expect(fx.memberships).not.toHaveBeenCalled();
  });

  it("inviteClientAdminAction no longer exists; inviteTeamMemberAction replaced it (mutation: leave it exported -> FAILS)", () => {
    const actions = readFileSync(path.join(here, "actions.ts"), "utf8");
    expect(actions).not.toMatch(/inviteClientAdminAction/);
    const sectionSrc = readFileSync(path.join(here, "client-access-section.tsx"), "utf8");
    expect(sectionSrc).not.toMatch(/inviteClientAdminAction|clerkClient/);
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
