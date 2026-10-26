import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { LocaleProvider } from "@/components/locale-provider";

// A switchable flag, not a fixed `isAgency: false`: a fixed stub can never
// exercise the agency branch, so `audience={isAgency ? "agency" : "client"}`
// could be replaced by a hard-coded "client" and every test here would still
// pass (Opus review of 2223893).
// `role` (M7a PR-4 Task 10): also switchable, so the paused banner's own
// audience split (owner / member) can't be hard-coded either.
const auth = vi.hoisted(() => ({ isAgency: false, role: "owner" as string | null }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "u", isAgency: auth.isAgency, role: auth.role }) }));
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
// Mis preferencias: the person's own language, from the one per-request read.
const prefs = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: prefs.language, theme: null }) }));
// The paused verdict (M7a PR-4 Task 10, plan G12): mocked at this boundary,
// not @bis/db — standing-read.test.ts already proves billingVerdictFor's own
// fail-soft/switch contract; this file's job is the LAYOUT's wiring (which
// audience, which cause, mutual exclusivity with the payment-failed banner),
// so it trusts that contract rather than re-proving it with a double mock.
const verdict = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/billing/standing-read", () => ({ billingVerdictFor: (...a: unknown[]) => verdict.fn(...a) }));

const { default: Layout } = await import("./layout");
const { BillingBanner } = await import("@/components/billing-banner");
const { BillingPausedBanner } = await import("@/components/billing-paused-banner");

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
const NOT_PAUSED = { paused: false, voice: true, concierge: true, forward: true, cause: null as "payment" | "ended" | null, pausedAt: null as string | null };

beforeEach(() => {
  billing.read.mockReset();
  billing.read.mockResolvedValue({ complimentary: true, subscriptionStatus: "active", billingPausedAt: null });
  verdict.fn.mockReset();
  verdict.fn.mockResolvedValue(NOT_PAUSED);
  auth.isAgency = false;
  auth.role = "owner";
  dbRow.language = null;
  prefs.language = null;
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

  // Staff and roles: under 0066_staff_and_roles.sql's account_billing_owner_read,
  // a client Staff session reads NO row on the RLS client — RLS filtering,
  // not an error. getAccountBilling's own .maybeSingle() already turns "no
  // row" into `null` rather than throwing, and showsPaymentFailedBanner(null)
  // is already `false` — so this is the SAME code path readAccountBilling's
  // happy case takes for an unbilled account, confirmed here by test rather
  // than by reading, with the Staff case named explicitly so a future reader
  // does not mistake "no row" for "a fault".
  it("a client Staff session (no account_billing row under RLS) renders no banner, logs nothing, and still renders the page — null is policy, not a fault (mutation: getAccountBilling throwing on no row (.single()) → the console assertion FAILS; showsPaymentFailedBanner returning true for null → the banner assertion FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    auth.isAgency = false;
    billing.read.mockResolvedValue(null);
    const tree = await render();
    expect(find(tree, BillingBanner)).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
    expect((tree as ReactElement<{ children: ReactNode[] }>).props.children).toContain("page");
    log.mockRestore();
  });

  it("passes the request's resolved locale to the payment-failed banner too (PR-4 Task 10; mutation: drop the locale prop from the layout's BillingBanner call → FAILS)", async () => {
    dbRow.language = "es";
    auth.isAgency = false;
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "past_due", billingPausedAt: null });
    const tree = await render();
    expect(find(tree, BillingBanner).map((b) => (b.props as { locale: string }).locale)).toEqual(["es"]);
  });
});

describe("account layout: the paused banner (PR-4 Task 10, plan G12)", () => {
  it("an owner in a payment-caused pause sees the owner banner, with its cause and the resolved locale (mutation: drop the cause/locale props, or default cause to \"ended\" → FAILS)", async () => {
    auth.isAgency = false;
    auth.role = "owner";
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "payment", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await render();
    expect(find(tree, BillingPausedBanner).map((b) => b.props)).toMatchObject([
      { audience: "owner", accountId: "a", cause: "payment", locale: "en" },
    ]);
  });

  it("an owner in an ended-plan pause sees the ended cause, never defaulted to payment (mutation: hard-code cause to \"payment\" → FAILS)", async () => {
    auth.isAgency = false;
    auth.role = "owner";
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "ended", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await render();
    expect(find(tree, BillingPausedBanner).map((b) => (b.props as { cause: string }).cause)).toEqual(["ended"]);
  });

  it("Staff and Technicians (any non-owner client role) get the MEMBER banner, not the owner's (mutation: treat every client role as owner → FAILS)", async () => {
    auth.isAgency = false;
    auth.role = "staff";
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "payment", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await render();
    expect(find(tree, BillingPausedBanner).map((b) => (b.props as { audience: string }).audience)).toEqual(["member"]);
  });

  it("the agency sees the AGENCY banner inside this account (mutation: hard-code audience to \"owner\" regardless of isAgency → FAILS)", async () => {
    auth.isAgency = true;
    auth.role = null;
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "ended", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await render();
    expect(find(tree, BillingPausedBanner).map((b) => (b.props as { audience: string }).audience)).toEqual(["agency"]);
  });

  it("never renders the paused banner beside the payment-failed one, even when the billing row is itself past_due (mutation: render both → FAILS)", async () => {
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "past_due", billingPausedAt: "2026-10-01T00:00:00Z" });
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "payment", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await render();
    expect(find(tree, BillingPausedBanner)).toHaveLength(1);
    expect(find(tree, BillingBanner)).toHaveLength(0);
  });

  // Covers both "the switch is off" and "the underlying read failed": Task 7's
  // own contract (standing-read.test.ts) guarantees billingVerdictFor decays
  // to this exact NOT_PAUSED shape in both cases, so from the layout's side
  // they are indistinguishable — one assertion on the resolved shape is the
  // real behavior, not a second copy of the same mock dressed up as a new case.
  it("verdict.paused false (switch off, or a failed read decayed to it) → no paused banner, and the payment-failed banner still works normally (mutation: gate the payment-failed banner on verdict.paused too → FAILS)", async () => {
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "past_due", billingPausedAt: null });
    verdict.fn.mockResolvedValue(NOT_PAUSED);
    const tree = await render();
    expect(find(tree, BillingPausedBanner)).toHaveLength(0);
    expect(find(tree, BillingBanner)).toHaveLength(1);
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

  // Owner rule (mis preferencias): a person's own language wins for everyone.
  it("a person's own language wins: an operator who chose Spanish, and a client who chose English on a Spanish account (mutation: drop userLanguage from the layout's requestLocale call -> FAILS)", async () => {
    auth.isAgency = true; prefs.language = "es";
    expect(find(await render(), LocaleProvider).map((p) => (p.props as { locale: string }).locale)).toEqual(["es"]);
    auth.isAgency = false; dbRow.language = "es"; prefs.language = "en";
    expect(find(await render(), LocaleProvider).map((p) => (p.props as { locale: string }).locale)).toEqual(["en"]);
  });
});
