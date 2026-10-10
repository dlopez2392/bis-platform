import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * The Team page (staff and roles, spec §8): the client Owner's own route,
 * which the agency reaches too. requireAccountOwner is the boundary (a
 * client Staff is sent to their dashboard), so it runs before anything is
 * read. Called, not rendered (billing/page.test.ts's form).
 */
const guard = vi.hoisted(() => ({ allowed: true, isAgency: false, order: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAccountOwner: async (id: string) => {
    guard.order.push(`guard:${id}`);
    if (!guard.allowed) throw new Error("NEXT_REDIRECT");
    return { userId: "user_x", isAgency: guard.isAgency };
  },
}));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    guard.order.push("db");
    return { from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { clerk_org_id: "org_9" }, error: null }) }; return c; } };
  },
}));
const section = vi.hoisted(() => ({ TeamSection: () => null }));
vi.mock("@/components/team/team-section", () => section);

const { default: TeamPage } = await import("./page");
const { TeamSkeleton } = await import("@/components/team/team-card");

function all(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...all(el.props.children as ReactNode)];
}
const page = () => TeamPage({ params: Promise.resolve({ accountId: "a1" }) });

beforeEach(() => {
  guard.allowed = true;
  guard.isAgency = false;
  guard.order = [];
});

describe("the Team page", () => {
  it("requireAccountOwner is its first call: a Staff (redirected) gets nothing back (mutation: drop the guard -> FAILS)", async () => {
    guard.allowed = false;
    await expect(page()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.order).toEqual(["guard:a1"]);
  });

  it("mounts TeamSection for THIS account in its own Suspense, reading nothing itself (mutation: read the account in the page again -> FAILS), the shared skeleton as fallback (mutation: render it outside Suspense -> FAILS)", async () => {
    const els = all(await page());
    // Fix round 1, M5: the page reads nothing itself; TeamSection reads the
    // account once (team-section.test.ts).
    expect(guard.order).toEqual(["guard:a1"]);
    const boundary = els.find((e) => e.type === Suspense);
    expect(boundary).toBeTruthy();
    const fallback = boundary!.props.fallback as ReactElement;
    expect(isValidElement(fallback) && fallback.type).toBe(TeamSkeleton);
    const child = boundary!.props.children as ReactElement<Record<string, unknown>>;
    expect(child.type).toBe(section.TeamSection);
    expect(child.props).toEqual({ accountId: "a1", viewer: "owner" });
  });

  it("the agency sees the agency's copy (mutation: viewer always owner -> FAILS)", async () => {
    guard.isAgency = true;
    const boundary = all(await page()).find((e) => e.type === Suspense)!;
    expect((boundary.props.children as ReactElement<Record<string, unknown>>).props.viewer).toBe("agency");
  });
});
