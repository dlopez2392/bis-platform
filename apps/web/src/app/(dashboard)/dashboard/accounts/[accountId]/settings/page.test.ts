import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * ONE thing under test: the agency's Settings page hands BrandingPanel the
 * account's mailing address (migration 0048), read through the SAME
 * request-scoped client this page uses for `getBranding` — it deliberately
 * reads through `dbForRequest()`, where the client's Branding page reads
 * through `serviceDb()` (see that page's comment), and neither is to change.
 *
 * The page is called, not rendered: the panel's props are found by walking
 * the element tree it returns, so none of the page's other cards (Radix
 * Selects, dialogs, the Clerk member list) have to survive a render here.
 */
vi.mock("@/lib/auth", () => ({ requireAgencyOnlyAccountAccess: async () => ({ userId: "user_1" }) }));

const fx = vi.hoisted(() => ({
  mailingAddress: null as string | null,
  mailingReads: [] as unknown[][],
  brandingReads: [] as unknown[][],
  /** The request-scoped client. Answers the page's one inline accounts read. */
  requestDb: {
    tag: "dbForRequest",
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { clerk_org_id: null, client_access_enabled: false, report_emails: [], alert_phone: null },
            error: null,
          }),
        }),
      }),
    }),
  },
  service: { tag: "serviceDb" },
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => fx.requestDb }));

vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => fx.service,
  listCustomFields: async () => [],
  listCustomValues: async () => [],
  listBlueprints: async () => [],
  getBranding: async (...args: unknown[]) => {
    fx.brandingReads.push(args);
    return {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
    };
  },
  getMailingAddress: async (...args: unknown[]) => {
    fx.mailingReads.push(args);
    return fx.mailingAddress;
  },
  getSendingIdentity: async () => ({ fromEmail: null }),
  getSiteForAccount: async () => null,
  countTrafficDays: async () => 0,
  brandLogoUrl: (p: string) => `https://example.test/${p}`,
}));

// Both third parties answer NEVER. The page must still resolve, because the
// cards that read them stream in their own <Suspense> (see the describe at
// the bottom). A page that awaited either itself would hang every test here.
const never = () => new Promise<never>(() => {});
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: never }));
vi.mock("@/lib/vercel/web-analytics", () => ({
  vercelAnalyticsFromEnv: () => ({ listProjects: never }),
}));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: async () => ({ ok: false, reason: "a2p_not_approved" }),
}));

// "use server" modules — stubbed, never imported into a vitest run.
const noop = async () => ({ ok: true });
vi.mock("./actions", () => ({
  createFieldAction: noop, upsertValueAction: noop, setClientAccessAction: noop,
  inviteClientAdminAction: noop, setFromEmailAction: noop, setReportEmailsAction: noop,
  setAlertPhoneAction: noop, startAlertPhoneVerificationAction: noop,
  confirmAlertPhoneVerificationAction: noop,
}));
vi.mock("../branding/actions", () => ({
  setBrandingAction: noop, removeBrandLogoAction: noop, restoreBrandLogoAction: noop,
}));
vi.mock("../website/actions", () => ({
  saveSiteAction: noop, testSiteConnectionAction: noop, unlinkSiteAction: noop,
}));
vi.mock("../../../blueprints/actions", () => ({ captureBlueprintAction: noop }));
vi.mock("./billing-actions", () => ({
  sendBillingLinkAction: noop, markComplimentaryAction: noop, removeComplimentaryAction: noop, changePlanAction: noop,
}));

const panel = vi.hoisted(() => ({ BrandingPanel: () => null }));
vi.mock("@/components/branding-panel", () => panel);

const { default: SettingsPage } = await import("./page");
const { BillingSection, BillingCardSkeleton } = await import("./billing-section");
const { ClientAccessSection } = await import("./client-access-section");
const { ClientAccessSkeleton } = await import("./client-access-panel");
const { WebsiteSection } = await import("./website-section");
const { LinkSiteSkeleton } = await import("../website/link-site-card");

/** Depth-first search of the returned element tree for BrandingPanel's props. */
function findPanelProps(node: ReactNode): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPanelProps(child as ReactNode);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (node.type === panel.BrandingPanel) return props;
  return findPanelProps(props.children as ReactNode);
}

async function panelProps() {
  const el = await SettingsPage({
    params: Promise.resolve({ accountId: "a1" }),
    searchParams: Promise.resolve({}),
  });
  const props = findPanelProps(el);
  expect(props, "the Settings page must render BrandingPanel").not.toBeNull();
  return props!;
}

/** Every element in the tree the page returns, depth first. */
async function pageElements() {
  const el = await SettingsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({}) });
  const all: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) { n.forEach((c) => walk(c as ReactNode)); return; }
    if (!isValidElement(n)) return;
    all.push(n as ReactElement<Record<string, unknown>>);
    walk((n.props as { children?: ReactNode }).children);
  };
  walk(el);
  return all;
}

/** The <Suspense> whose one child is an element of `type`. */
function boundaryAround(all: ReactElement<Record<string, unknown>>[], type: unknown) {
  return all.find((e) => e.type === Suspense && isValidElement(e.props.children)
    && (e.props.children as ReactElement).type === type);
}

beforeEach(() => {
  fx.mailingAddress = null;
  fx.mailingReads = [];
  fx.brandingReads = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("settings page — the Branding panel's mailing address", () => {
  it("passes the stored address to the panel (mutation: pass mailingAddress={null} → FAILS)", async () => {
    fx.mailingAddress = "PO Box 12\nEdinburg, TX 78539";
    expect((await panelProps()).mailingAddress).toBe("PO Box 12\nEdinburg, TX 78539");
  });

  it("passes null when none is stored", async () => {
    expect((await panelProps()).mailingAddress).toBeNull();
  });

  it("reads it through the same request-scoped client as getBranding, not serviceDb() (mutation: getMailingAddress(serviceDb(), …) → FAILS)", async () => {
    await panelProps();
    expect(fx.brandingReads).toEqual([[fx.requestDb, "a1"]]);
    expect(fx.mailingReads).toEqual([[fx.requestDb, "a1"]]);
  });
});

describe("settings page — the Billing card", () => {
  it("mounts BillingSection for THIS account in its own Suspense boundary (skeleton fallback), directly after the client-access card's boundary (mutation: drop the mount → FAILS; render it outside Suspense → one slow billing read holds all of Settings, FAILS)", async () => {
    const all = await pageElements();
    const boundary = boundaryAround(all, BillingSection);
    expect(boundary, "BillingSection inside <Suspense>").toBeTruthy();
    expect(((boundary!.props.children as ReactElement).props as { accountId: string }).accountId).toBe("a1");
    const fallback = boundary!.props.fallback;
    expect(isValidElement(fallback) && fallback.type).toBe(BillingCardSkeleton);
    const column = all.find((e) => Array.isArray(e.props.children) && (e.props.children as unknown[]).includes(boundary));
    const siblings = (column!.props.children as unknown[]).filter((c) => isValidElement(c));
    expect(siblings[siblings.indexOf(boundary!) - 1]).toBe(boundaryAround(all, ClientAccessSection));
  });
});

/**
 * 2026-10-08, main run 37815300116: the palette's jump to Settings sat on the
 * previous page for more than 10s, because the page awaited two sequential
 * Clerk calls (the client-access member list) and Vercel's project list
 * before it rendered anything. Both now stream in their own boundary. The
 * mocks at the top make Clerk and Vercel answer never, so every test in this
 * file proves the first half: the page resolves without them.
 */
describe("settings page — third parties never hold the page", () => {
  it("mounts ClientAccessSection for THIS account's org and switch in its own Suspense, skeleton fallback (mutation: render it outside Suspense, or read Clerk in the page again → FAILS)", async () => {
    const boundary = boundaryAround(await pageElements(), ClientAccessSection);
    expect(boundary, "ClientAccessSection inside <Suspense>").toBeTruthy();
    expect((boundary!.props.children as ReactElement).props).toEqual({
      accountId: "a1", clerkOrgId: null, enabled: false,
    });
    const fallback = boundary!.props.fallback;
    expect(isValidElement(fallback) && fallback.type).toBe(ClientAccessSkeleton);
  });

  it("mounts WebsiteSection with the linked site and stored days in its own Suspense, skeleton fallback (mutation: list Vercel projects in the page again → FAILS)", async () => {
    const boundary = boundaryAround(await pageElements(), WebsiteSection);
    expect(boundary, "WebsiteSection inside <Suspense>").toBeTruthy();
    expect((boundary!.props.children as ReactElement).props).toEqual({
      accountId: "a1", linked: null, daysStored: 0,
    });
    const fallback = boundary!.props.fallback;
    expect(isValidElement(fallback) && fallback.type).toBe(LinkSiteSkeleton);
  });
});
