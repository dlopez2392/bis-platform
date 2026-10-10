import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { LocaleProvider } from "@/components/locale-provider";

// A switchable flag, not a fixed `isAgency: false`: a fixed stub can never
// exercise the agency branch, so `audience={isAgency ? "agency" : "client"}`
// could be replaced by a hard-coded "client" and every test here would still
// pass (Opus review of 2223893).
const auth = vi.hoisted(() => ({ isAgency: false }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "u", isAgency: auth.isAgency }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
// Task 6 (Spanish-runtime lane): `language` is a mutable hoisted field, same
// shape as `auth.isAgency` above, so a test can set an account's own stored
// language without a second mock factory.
const dbRow = vi.hoisted(() => ({ language: null as string | null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({ from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { id: "a", name: "A", language: dbRow.language }, error: null }) }; return c; } }),
}));
const billing = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), getAccountBilling: billing.read }));

const { default: Layout } = await import("./layout");
const { BillingBanner } = await import("@/components/billing-banner");

function find(node: ReactNode, type: unknown): ReactElement[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap((n) => find(n, type)) : [];
  return [...(node.type === type ? [node] : []), ...find((node.props as { children?: ReactNode }).children, type)];
}
const render = () => Layout({ children: "page", params: Promise.resolve({ accountId: "a" }) });

// The returned tree is `<LocaleProvider>{banner}{children}</LocaleProvider>`
// — no wrapping element of its own (decision D: `lang` sits on the converted
// parts only, never on the whole page). `find()` above recurses regardless
// of depth; this helper is only needed where a test reaches past `find()`
// for the raw children array.
function content(tree: ReactNode): { children: ReactNode } {
  return (tree as ReactElement<{ children: ReactNode }>).props;
}

/** Every element in the tree that carries a `lang` prop. */
function withLang(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap(withLang) : [];
  const props = node.props as { lang?: string; children?: ReactNode };
  return [...(props.lang !== undefined ? [node] : []), ...withLang(props.children)];
}

// A BLOCK body, not `() => billing.read.mockReset()`: vitest treats a
// function returned from beforeEach as that test's teardown, and mockReset
// returns the mock itself, which would then be CALLED after the test (the
// plan review saw exactly that: `Error: getAccountBilling failed: timeout`).
beforeEach(() => {
  billing.read.mockReset();
  billing.read.mockResolvedValue({ complimentary: true, subscriptionStatus: "active", billingPausedAt: null });
  auth.isAgency = false;
  dbRow.language = null;
});

describe("account layout: the payment-failed banner (G21)", () => {
  it("shows the client banner on every page of a past-due account, and none on a paid one or an incomplete first payment (mutation: never mount it → FAILS; mount it for active → FAILS; mount it for incomplete → FAILS)", async () => {
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "past_due", billingPausedAt: null });
    expect(find(await render(), BillingBanner).map((b) => (b.props as { audience: string }).audience)).toEqual(["client"]);
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "active", billingPausedAt: null });
    expect(find(await render(), BillingBanner)).toHaveLength(0);
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "incomplete", billingPausedAt: null });
    expect(find(await render(), BillingBanner)).toHaveLength(0);
  });

  it("shows the AGENCY banner, inside that same account, on a past-due subscription (mutation: hard-code audience=\"client\" in the layout instead of threading isAgency → FAILS)", async () => {
    auth.isAgency = true;
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "past_due", billingPausedAt: null });
    expect(find(await render(), BillingBanner).map((b) => (b.props as { audience: string }).audience)).toEqual(["agency"]);
  });

  it("shows no banner once billing is paused, even on a past-due subscription (mutation: swap showsPaymentFailedBanner for a bare subscriptionStatus === \"past_due\" check → FAILS)", async () => {
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "past_due", billingPausedAt: "2026-09-01T00:00:00Z" });
    expect(find(await render(), BillingBanner)).toHaveLength(0);
  });

  it("a failed billing read logs and renders the page WITHOUT a banner: the layout never goes down with billing (mutation: let it throw → every page of the account errors, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    billing.read.mockRejectedValue(new Error("getAccountBilling failed: timeout"));
    const tree = await render();
    expect(find(tree, BillingBanner)).toHaveLength(0);
    expect(content(tree).children).toContain("page");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("account layout: mounts LocaleProvider with the request's resolved locale (Task 6, Spanish-runtime lane)", () => {
  it("a client-role account with language=\"es\" provides \"es\" to the page's client components (mutation: drop the requestLocale/LocaleProvider wiring → FAILS, reverts to \"en\")", async () => {
    dbRow.language = "es";
    auth.isAgency = false;
    const tree = await render();
    expect(find(tree, LocaleProvider).map((p) => (p.props as { locale: string }).locale)).toEqual(["es"]);
  });

  // Decision D (orchestrator, 2026-10-10): `lang="es"` goes only on the parts
  // that are actually Spanish (the sidebar nav labels, the topbar presence,
  // the dashboard KPI row) — never on the whole page, most of which is still
  // English and would then be announced with Spanish pronunciation.
  it("puts no lang attribute on the page content, even for a Spanish account (decision D; mutation: wrap {children} in <div lang={locale}> again → FAILS)", async () => {
    dbRow.language = "es";
    auth.isAgency = false;
    expect(withLang(await render())).toEqual([]);
  });

  it("an operator (agency) stays English even on a Spanish-language account (owner rule: operators don't inherit the client's own language)", async () => {
    dbRow.language = "es";
    auth.isAgency = true;
    const tree = await render();
    expect(find(tree, LocaleProvider).map((p) => (p.props as { locale: string }).locale)).toEqual(["en"]);
  });
});
