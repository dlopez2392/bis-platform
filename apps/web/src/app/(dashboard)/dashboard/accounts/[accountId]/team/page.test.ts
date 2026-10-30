import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The Team page (staff and roles, spec §8): the client Owner's own route,
 * which the agency reaches too. requireAccountOwner is the boundary (a
 * client Staff is sent to their dashboard), so it runs before anything is
 * read. Called, not rendered (billing/page.test.ts's form).
 *
 * F-118 part 1 (plan Task 10; spec 6.1): below TeamSection, the BIS access
 * section lives in its OWN Suspense inside its OWN frame (`BisAccessFrame`,
 * real — not mocked, so its `id="bis-access"` is real markup), reading its
 * own data (`BisAccessSection`, mocked the same way `TeamSection` is: a
 * sync stub, since react-dom/server cannot render an unmocked async Server
 * Component). `all()`'s `.find()` returns the FIRST Suspense in the tree, so
 * every PRE-EXISTING assertion below still finds TeamSection's own boundary
 * unchanged.
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
const section = vi.hoisted(() => ({
  TeamSection: () => null,
  BisAccessSection: () => null,
}));
vi.mock("@/components/team/team-section", () => ({ TeamSection: section.TeamSection }));
vi.mock("@/components/access-log/bis-access-section", () => ({ BisAccessSection: section.BisAccessSection }));

const { default: TeamPage } = await import("./page");
const { TeamSkeleton } = await import("@/components/team/team-card");
const { BisAccessFrame } = await import("@/components/access-log/bis-access-frame");
const { BisAccessSkeleton } = await import("@/components/access-log/bis-access-skeleton");

function all(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...all(el.props.children as ReactNode)];
}
const page = (searchParams?: { accessBefore?: string; locale?: string }) =>
  TeamPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(searchParams ?? {}) });

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

// F-118 part 1 (plan Task 10; spec 6.1): the BIS access section, below Team,
// readable by the client's Owner and by the agency — never by Staff or a
// Technician, who never even reach this page (requireAccountOwner above).
describe("the Team page: BIS access (F-118 part 1)", () => {
  it("renders the frame with id=\"bis-access\" as real markup, for an Owner and for the agency (mutation: drop BisAccessFrame -> FAILS)", async () => {
    for (const isAgency of [false, true]) {
      guard.isAgency = isAgency;
      const html = renderToStaticMarkup(await page());
      expect(html).toContain('id="bis-access"');
    }
  });

  it("mounts BisAccessSection for THIS account, with isAgency, inside its own Suspense (the shared BisAccessSkeleton as fallback) inside the frame (mutations: drop the frame -> FAILS; render the Suspense outside the frame -> FAILS)", async () => {
    const els = all(await page());
    const frame = els.find((e) => e.type === BisAccessFrame);
    expect(frame).toBeTruthy();
    const inner = all(frame!.props.children as ReactNode);
    const boundary = inner.find((e) => e.type === Suspense);
    expect(boundary).toBeTruthy();
    const fallback = boundary!.props.fallback as ReactElement;
    expect(isValidElement(fallback) && fallback.type).toBe(BisAccessSkeleton);
    const child = boundary!.props.children as ReactElement<Record<string, unknown>>;
    expect(child.type).toBe(section.BisAccessSection);
    expect(child.props).toEqual({ accountId: "a1", isAgency: false, before: undefined });
  });

  it("passes isAgency through for the agency too (mutation: hardcode isAgency -> FAILS)", async () => {
    guard.isAgency = true;
    const els = all(await page());
    const frame = els.find((e) => e.type === BisAccessFrame)!;
    const boundary = all(frame.props.children as ReactNode).find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.isAgency).toBe(true);
  });

  it("passes this request's OWN accessBefore cursor to the section (mutation: drop accessBefore -> FAILS)", async () => {
    const els = all(await page({ accessBefore: "CURSOR123" }));
    const frame = els.find((e) => e.type === BisAccessFrame)!;
    const boundary = all(frame.props.children as ReactNode).find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.before).toBe("CURSOR123");
  });

  it("threads the request's ?locale= (the QA override) to the section, as documents/page.tsx does (mutation: drop it -> FAILS)", async () => {
    const els = all(await page({ locale: "pseudo" }));
    const frame = els.find((e) => e.type === BisAccessFrame)!;
    const boundary = all(frame.props.children as ReactNode).find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.qaLocale).toBe("pseudo");
  });
});
