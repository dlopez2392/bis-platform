import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { AccountBilling, Plan } from "@bis/db";

const guard = vi.hoisted(() => ({ allowed: true, order: [] as string[], isAgency: false }));
vi.mock("@/lib/auth", () => ({
  requireAccountOwner: async () => { guard.order.push("guard"); if (!guard.allowed) throw new Error("NEXT_REDIRECT"); return { userId: "u", isAgency: guard.isAgency }; },
}));
const dbm = vi.hoisted(() => ({ getAccountBilling: vi.fn(), getPlan: vi.fn(), sumUsageSince: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbm, serviceDb: () => ({ tag: "service" }),
}));
// `language`, beside the existing `timezone` field, for requestLocale — the
// same per-request shape the account layout reads (M7a PR-4 Task 10).
const accountRow = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    guard.order.push("db");
    return { tag: "rls", from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { timezone: "America/Chicago", language: accountRow.language }, error: null }) }; return c; } };
  },
}));
// Mis preferencias: the person's own language, the same per-request read
// the layout uses.
const prefs = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: prefs.language, theme: null }) }));
// The paused verdict (plan G12): mocked at this boundary, not @bis/db — see
// the account layout's own test file for why (standing-read.test.ts already
// proves billingVerdictFor's fail-soft/switch contract).
const verdict = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/billing/standing-read", () => ({ billingVerdictFor: (...a: unknown[]) => verdict.fn(...a) }));
// F-088 PR 3: the facts read is mocked at its own boundary (capabilities.test.ts proves what it reads); the
// GRADE is the real capabilityState, so these tests prove the words the page reaches from real grades.
const facts = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/surfaces/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()), readCapabilityFacts: (...a: unknown[]) => facts.fn(...a),
}));
// The brand name the support mail's subject names (never accounts.name): the cached tenant read.
const brand = vi.hoisted(() => ({ name: "Rio Roofing" as string | null }));
vi.mock("@/lib/branding/tenant-theme-reader", () => ({ getTenantBranding: async () => ({ brandName: brand.name }) }));
// Echoes the bound locale back as `error` (S-10 T6 test below), rather than
// a fixed "x" — the real action's own shape, with nothing to assert on its
// REAL English/Spanish text here; billing/actions.test.ts already covers that.
vi.mock("./actions", () => ({ openBillingPortalAction: async (_accountId: string, locale?: string) => ({ ok: false, error: locale ?? "x" }) }));

const { default: BillingPage } = await import("./page");
const { EmptyState } = await import("@/components/empty-state");
const { ManageBillingButton } = await import("./manage-billing-button");
const { m } = await import("@/lib/messages");
const { DotPill } = await import("@/components/dot-pill");
const { Card } = await import("@/components/ui/card");
const { Button } = await import("@/components/ui/button");
const { PageHeader } = await import("@/components/page-header");
const { SurfaceStateNote: Note } = await import("@/components/surface-state-note");

/** Every element of a type in the tree the page returns (it is CALLED, not rendered). */
function find(node: ReactNode, type: unknown): ReactElement[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap((n) => find(n, type)) : [];
  const own = node.type === type ? [node] : [];
  return [...own, ...find((node.props as { children?: ReactNode }).children, type)];
}
const text = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children);
  return "";
};
/** Every element in the tree that carries a `lang` prop (same helper the
 *  account layout's own test file uses). */
function withLang(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap(withLang) : [];
  const props = node.props as { lang?: string; children?: ReactNode };
  return [...(props.lang !== undefined ? [node] : []), ...withLang(props.children)];
}
const NOT_PAUSED = { paused: false, voice: true, concierge: true, forward: true, cause: null as "payment" | "ended" | null, pausedAt: null as string | null };

const PLAN = { id: "p1", agencyId: "ag", name: "Growth", monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true }, allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 }, stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "", updatedAt: "" } as Plan;
const PAID = { accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, pauseLiftedAt: null, stripeCheckedAt: null, billingStartedAt: "", createdAt: "", updatedAt: "" } as AccountBilling;
const OK_FACTS = (over: Record<string, unknown> = {}) => ({
  read: "ok" as const, verdict: { paused: false, voice: true, concierge: true, forward: true }, trade: "roofing",
  profile: { enabled: true, forwardCalls: false }, numberStatuses: ["live"], conciergeLive: true, a2pStatus: "approved", ...over,
});
const page = (searchParams: Record<string, string> = {}) =>
  BillingPage({ params: Promise.resolve({ accountId: "a" }), searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  guard.allowed = true;
  guard.order = [];
  guard.isAgency = false;
  for (const f of Object.values(dbm)) f.mockReset();
  dbm.getPlan.mockResolvedValue(PLAN);
  dbm.sumUsageSince.mockResolvedValue({ voice_minutes: 312, sms: 0, ai_chats: 0 });
  accountRow.language = null;
  prefs.language = null;
  verdict.fn.mockReset();
  verdict.fn.mockResolvedValue(NOT_PAUSED);
  facts.fn.mockReset();
  facts.fn.mockResolvedValue(OK_FACTS());
  brand.name = "Rio Roofing";
});

describe("the client Billing page", () => {
  it("requireAccountOwner runs before anything is read: another account's id (or a client Staff) never reads a row (mutation: read first → FAILS)", async () => {
    guard.allowed = false;
    await expect(page()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.order).toEqual(["guard"]);
    expect(dbm.getAccountBilling).not.toHaveBeenCalled();
  });

  it("an account that is not billed yet gets the empty state, which says what will appear here (DESIGN rule 5) (mutation: render an empty card → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(null);
    const tree = await page();
    const [empty] = find(tree, EmptyState);
    expect(empty?.props).toMatchObject({ title: m["billing.page.empty.title"], body: m["billing.page.empty.body"] });
  });

  it("a subscriber sees plan, price, '312 of 500 minutes' since the period start, the next invoice and Manage billing; the plan is read through the SERVICE path keyed by the account's OWN row (PR-1 binding: never widen plans_agency_read) (mutation: read the plan on the RLS client → it is invisible to a client, FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    const tree = await page();
    expect(dbm.getAccountBilling.mock.calls[0]![0]).toMatchObject({ tag: "rls" });
    expect(dbm.getPlan).toHaveBeenCalledWith({ tag: "service" }, "p1");
    expect(dbm.sumUsageSince).toHaveBeenCalledWith(expect.objectContaining({ tag: "rls" }), "a", "2026-10-12T17:00:00.000Z");
    const words = text(tree);
    for (const s of ["Growth", "$149.00/month", "312 of 500 minutes", "Since Oct 12", "Next invoice Nov 12"]) expect(words).toContain(s);
    expect(find(tree, ManageBillingButton)).toHaveLength(1);
  });

  it("a complimentary account sees its plan and usage, says there is nothing to pay, and has no Manage billing (mutation: always render the button → a portal with no customer, FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, complimentary: true, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null });
    const tree = await page();
    expect(text(tree)).toContain(m["billing.page.complimentary"]);
    expect(find(tree, ManageBillingButton)).toHaveLength(0);
  });

  it("a first payment still going through says 'Payment processing' on a warning dot on this page, whoever opens it, never 'Payment failed' (the agency's Settings card keeps G13's word); no next invoice; the card help line (mutation: use BILLING_STATUS_TREATMENTS as is → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, subscriptionStatus: "incomplete" });
    const tree = await page();
    const [pill] = find(tree, DotPill);
    expect(pill?.props).toMatchObject({ label: m["billing.page.status.processing"], dot: "bg-warning" });
    const words = text(tree);
    expect(words).not.toContain(m["billing.status.payment_failed"]);
    expect(words).not.toContain("Next invoice");
    const [button] = find(tree, ManageBillingButton);
    expect(button?.props).toMatchObject({ help: m["billing.page.manageHelp"] });
  });

  it("a canceled subscription says it has ended and still offers Manage billing for past invoices, with help that does not ask for a card (mutation: hide the button on canceled → FAILS; the card help line on canceled → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, subscriptionStatus: "canceled" });
    const tree = await page();
    expect(text(tree)).toContain(m["billing.page.canceled"]);
    const buttons = find(tree, ManageBillingButton);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.props).toMatchObject({ help: m["billing.page.manageHelp.canceled"] });
  });

  // M7a PR-4 Task 10 (plan G12): the paused line sits above Manage billing,
  // which keeps working while paused (the Owner's own way to fix it).
  it("a payment-caused pause shows the payment words above Manage billing, which still renders (mutation: swap payment/ended text, or hide the button while paused → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "payment", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await page();
    const words = text(tree);
    expect(words).toContain(m["billing.page.paused.payment"]);
    expect(words).not.toContain(m["billing.page.paused.ended"]);
    expect(find(tree, ManageBillingButton)).toHaveLength(1);
  });

  it("an ended-plan pause shows its own words, never the payment ones (mutation: default cause to 'payment' → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", "");
    dbm.getAccountBilling.mockResolvedValue(PAID);
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "ended", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await page();
    const words = text(tree);
    expect(words).toContain(m["billing.page.paused.endedNoContact"]);
    expect(words).not.toContain(m["billing.page.paused.payment"]);
    vi.unstubAllEnvs();
  });

  it("an ended-plan pause's Manage billing help asks for no card: it is the canceled help (design review I4) (mutation: pick the help from view.status alone → FAILS: 'Update your card' under 'your plan has ended')", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, subscriptionStatus: "canceled", billingPausedAt: "2026-10-01T00:00:00Z" });
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "ended", pausedAt: "2026-10-01T00:00:00Z" });
    const [button] = find(await page(), ManageBillingButton);
    expect((button!.props as { help: string }).help).toBe(m["billing.page.manageHelp.canceled"]);
    // A payment pause keeps the card help: updating the card IS the way back.
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "payment", pausedAt: "2026-10-01T00:00:00Z" });
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, subscriptionStatus: "past_due", billingPausedAt: "2026-10-01T00:00:00Z" });
    const [card] = find(await page(), ManageBillingButton);
    expect((card!.props as { help: string }).help).toBe(m["billing.page.manageHelp"]);
  });

  it("\"contact us\" has a target: AGENCY_SUPPORT_EMAIL as a mailto link, read on the server; unset, the line names the team that set up the account — in English and Spanish (design review I4) (mutation: drop the link → FAILS; ignore the env → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "ended", pausedAt: "2026-10-01T00:00:00Z" });
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", "  help@agency.example ");
    const tree = await page();
    const [link] = find(tree, "a");
    expect((link!.props as { href: string }).href).toBe("mailto:help@agency.example");
    const [before] = m["billing.page.paused.ended"].split("{email}");
    expect(text(tree)).toContain(before!.trim());
    expect(text(tree)).toContain("help@agency.example");
    prefs.language = "es";
    const es = await page();
    expect(text(es)).toContain(m["billing.page.paused.ended.es"].split("{email}")[0]!.trim());
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", "");
    const none = await page();
    expect(find(none, "a")).toHaveLength(0);
    expect(text(none)).toContain(m["billing.page.paused.endedNoContact.es"]);
    prefs.language = null;
    vi.unstubAllEnvs();
  });

  it("no paused line at all when the account isn't paused (mutation: render the line unconditionally → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    const tree = await page();
    const words = text(tree);
    expect(words).not.toContain(m["billing.page.paused.payment"]);
    expect(words).not.toContain(m["billing.page.paused.ended"]);
  });

  it("the paused line carries lang for a Spanish account, and reads in Spanish (mutation: drop the lang attribute or the t() lookup → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    prefs.language = "es";
    verdict.fn.mockResolvedValue({ ...NOT_PAUSED, paused: true, cause: "payment", pausedAt: "2026-10-01T00:00:00Z" });
    const tree = await page();
    expect(withLang(tree).map((n) => (n.props as { lang: string }).lang)).toEqual(["es"]);
    expect(text(tree)).toContain(m["billing.page.paused.payment.es"]);
  });
});

// S-10 T6: the rest of the page's own words — title, subtitle, empty state,
// usage, status pill, Manage billing — read m[...] directly, English
// regardless of the reader's own stored choice (`prefs.language`).
describe("the client Billing page — Spanish (S-10 T6)", () => {
  it("renders the title, subtitle and empty state in Spanish for a Spanish-reading owner (mutation: hard-code m[key] → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(null);
    prefs.language = "es";
    const tree = await page();
    const { PageHeader } = await import("@/components/page-header");
    const [header] = find(tree, PageHeader);
    expect(header?.props).toMatchObject({ title: m["billing.page.title.es"], subtitle: m["billing.page.subtitle.es"] });
    const [empty] = find(tree, EmptyState);
    expect(empty?.props).toMatchObject({ title: m["billing.page.empty.title.es"], body: m["billing.page.empty.body.es"] });
  });

  it("renders the plan, usage, status pill and Manage billing help in Spanish, with the price and dates formatted in Spanish (mutation: thread locale into the view but not into formatDay → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    prefs.language = "es";
    const tree = await page();
    const words = text(tree);
    expect(words).toContain(m["billing.page.usage.es"]);
    expect(words).toContain("$149.00/mes");
    expect(words).toContain("312 de 500 minutos");
    expect(words).toContain("Desde el 12 oct");
    expect(words).toContain("Próxima factura el 12 nov");
    const [pill] = find(tree, DotPill);
    expect((pill!.props as { label: string }).label).toBe(m["billing.status.active.es"]);
    const [button] = find(tree, ManageBillingButton);
    expect((button!.props as { help: string }).help).toBe(m["billing.page.manageHelp.es"]);
  });

  it("the status pill and the complimentary/canceled lines read in Spanish (mutation: skip billingStatusTreatment on es → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, complimentary: true, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null });
    prefs.language = "es";
    expect(text(await page())).toContain(m["billing.page.complimentary.es"]);
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, subscriptionStatus: "canceled" });
    expect(text(await page())).toContain(m["billing.page.canceled.es"]);
  });

  it("'Payment processing' reads in Spanish on a first payment still going through (mutation: use PAYMENT_PROCESSING as-is → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, subscriptionStatus: "incomplete" });
    prefs.language = "es";
    const [pill] = find(await page(), DotPill);
    expect((pill!.props as { label: string }).label).toBe(m["billing.page.status.processing.es"]);
  });

  it("Manage billing's own action is bound with the reader's locale, not just the account id (mutation: bind the action with no locale → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    prefs.language = "es";
    const [button] = find(await page(), ManageBillingButton);
    const open = (button!.props as { open: () => Promise<{ ok: false; error: string }> }).open;
    expect(await open()).toEqual({ ok: false, error: "es" });
  });
});

// I2 (review fix round): the page passed `pseudo={pseudo}` and wrapped its
// own strings in `p()`, but nothing proved either survived a mutation —
// `pseudo={false}` on ManageBillingButton, or `p()` dropped from the
// chatsNote/usage lines, both read as correct to every PRE-EXISTING test
// above (none of them sets `?locale=pseudo` at all).
describe("the client Billing page — pseudo wiring (I2, review fix round)", () => {
  it("passes pseudo=true to ManageBillingButton, and wraps the usage lines and chatsNote, under BIS_I18N_QA + ?locale=pseudo (mutation: pseudo={false} on ManageBillingButton → FAILS; mutation: drop p() from chatsNote/usage → FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      dbm.getAccountBilling.mockResolvedValue(PAID);
      dbm.sumUsageSince.mockResolvedValue({ voice_minutes: 312, sms: 0, ai_chats: 0 });
      const tree = await page({ locale: "pseudo" });
      const [button] = find(tree, ManageBillingButton);
      expect((button!.props as { pseudo?: boolean }).pseudo).toBe(true);
      const { pseudoLocale } = await import("@/lib/i18n/pseudo-locale");
      const words = text(tree);
      expect(words).toContain(pseudoLocale(m["billing.usage.chatsNote"]));
      expect(words).toContain(pseudoLocale("312 of 500 minutes"));
      expect(words).not.toContain(m["billing.usage.chatsNote"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("with no ?locale=pseudo, pseudo=false reaches ManageBillingButton and nothing is wrapped (unaffected baseline)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    const tree = await page();
    const [button] = find(tree, ManageBillingButton);
    expect((button!.props as { pseudo?: boolean }).pseudo).toBe(false);
    expect(text(tree)).toContain(m["billing.usage.chatsNote"]);
  });
});


// F-088 PR 3: the upgrade page. "What your plan includes" (one note per capability, graded) and, only when a
// capability grades "in a bigger plan", "What a bigger plan adds" with the one way to ask.
describe("the Plan and billing page, F-088 PR 3", () => {
  const cardOf = (tree: ReactNode, id: "includes" | "bigger") =>
    find(tree, Card).filter((c) => (c.props as Record<string, unknown>)["data-surface-card"] === id);
  const notesIn = (card: ReactElement | undefined) => (card ? find(card, Note) : []);
  const SUPPORT = "help@agency.example";
  const NO_VOICE = { verdict: { paused: false, voice: false, concierge: true, forward: true } };

  it("the page and its nav entry are 'Plan and billing' / 'Plan y facturación' (mutation: revert either key → FAILS)", async () => {
    expect(m["billing.page.title"]).toBe("Plan and billing");
    expect(m["billing.page.title.es"]).toBe("Plan y facturación");
    expect(m["nav.billing"]).toBe("Plan and billing");
    expect(m["nav.billing.es"]).toBe("Plan y facturación");
    dbm.getAccountBilling.mockResolvedValue(PAID);
    const [header] = find(await page(), PageHeader);
    expect(header?.props).toMatchObject({ title: "Plan and billing" });
  });

  it("includes card: one graded note per capability (Sofía, website chat, texting), in that order, each with its own sentence (mutation: drop a row → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    const tree = await page();
    const notes = notesIn(cardOf(tree, "includes")[0]);
    expect(notes.map((n) => (n.props as { state: string }).state)).toEqual(["live", "live", "live"]);
    expect(notes.map((n) => (n.props as { sentence: string }).sentence)).toEqual([
      m["surface.sofia.sofia_answering"], m["surface.chat.chat_open"], m["surface.texting.texting_registered"],
    ]);
    expect(text(tree)).toContain(m["billing.includes.title"]);
    expect(facts.fn).toHaveBeenCalledWith("a");
  });

  it("billed with Sofía off in the plan: the bigger-plan card names Sofía only, with a mailto to the support address whose subject names the BRAND (mutation: always render the card → the all-on test FAILS; drop the mailto → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", ` ${SUPPORT} `);
    try {
      dbm.getAccountBilling.mockResolvedValue(PAID);
      facts.fn.mockResolvedValue(OK_FACTS(NO_VOICE));
      const tree = await page();
      const [card] = cardOf(tree, "bigger");
      expect(card).toBeDefined();
      const words = text(card);
      expect(words).toContain(m["billing.bigger.sofia"]);
      expect(words).not.toContain(m["billing.bigger.webChat"]);
      expect(words).not.toMatch(/\$\d/);
      const [link] = find(card, "a");
      expect((link!.props as { href: string }).href).toBe(`mailto:${SUPPORT}?subject=${encodeURIComponent("Plan change for Rio Roofing")}`);
      // The includes card grades the same fact: Sofía is "in a bigger plan" there too.
      const states = notesIn(cardOf(tree, "includes")[0]).map((n) => (n.props as { state: string }).state);
      expect(states).toEqual(["bigger_plan", "live", "live"]);
    } finally { vi.unstubAllEnvs(); }
  });

  it("both Sofía and the chat missing: one sentence each, one mailto (mutation: only the first capability → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", SUPPORT);
    try {
      dbm.getAccountBilling.mockResolvedValue(PAID);
      facts.fn.mockResolvedValue(OK_FACTS({ verdict: { paused: false, voice: false, concierge: false, forward: true }, conciergeLive: false }));
      const [card] = cardOf(await page(), "bigger");
      expect(text(card)).toContain(m["billing.bigger.sofia"]);
      expect(text(card)).toContain(m["billing.bigger.webChat"]);
      expect(find(card, "a")).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); }
  });

  it("everything on: no bigger-plan card and no ask (mutation: render the card unconditionally → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", SUPPORT);
    try {
      dbm.getAccountBilling.mockResolvedValue(PAID);
      const tree = await page();
      expect(cardOf(tree, "bigger")).toHaveLength(0);
      expect(cardOf(tree, "includes")).toHaveLength(1);
      expect(text(tree)).not.toContain(m["billing.bigger.title"]);
      expect(find(tree, "a").filter((a) => String((a.props as { href?: string }).href).startsWith("mailto:"))).toHaveLength(0);
    } finally { vi.unstubAllEnvs(); }
  });

  it("a paused or CRM-only grade is not 'a bigger plan': no card, no ask (mutation: ask on any not-live state → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    facts.fn.mockResolvedValue(OK_FACTS({ verdict: { paused: true, voice: false, concierge: false, forward: false }, numberStatuses: [], conciergeLive: false }));
    expect(cardOf(await page(), "bigger")).toHaveLength(0);
    facts.fn.mockResolvedValue(OK_FACTS({ trade: "restaurant", verdict: { paused: false, voice: false, concierge: false, forward: true }, numberStatuses: [], conciergeLive: false }));
    expect(cardOf(await page(), "bigger")).toHaveLength(0);
  });

  it("not billed yet: the 'Billing isn't set up yet' words stay AND the includes card shows, with no bigger-plan card (mutation: return the empty state early → includes FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(null);
    // Facts that WOULD grade Sofía "in a bigger plan": the unbilled page still shows no bigger-plan card.
    facts.fn.mockResolvedValue(OK_FACTS(NO_VOICE));
    const tree = await page();
    expect(find(tree, EmptyState)[0]?.props).toMatchObject({ title: m["billing.page.empty.title"] });
    expect(notesIn(cardOf(tree, "includes")[0])).toHaveLength(3);
    expect(cardOf(tree, "bigger")).toHaveLength(0);
  });

  it("a failed facts read says so in words with NO pill, never 'live', and asks for nothing (mutation: grade a failed read live, or show the pill → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    facts.fn.mockResolvedValue({ read: "failed" });
    const tree = await page();
    const notes = notesIn(cardOf(tree, "includes")[0]);
    expect(notes).toHaveLength(3);
    for (const n of notes) {
      const props = n.props as { state: string; word: string | null | undefined };
      expect(props.state).toBe("needs_setup");
      expect(props.word).toBeNull();
    }
    expect(notes.map((n) => (n.props as { sentence: string }).sentence)).toEqual([
      m["surface.sofia.read_failed"], m["surface.chat.read_failed"], m["surface.texting.read_failed"],
    ]);
    expect(cardOf(tree, "bigger")).toHaveLength(0);
  });

  it("texting words: live never promises texts go out; waiting names the phone carriers; setup reads 'BIS is setting up' to a client and points the agency at the Checklist (mutation: swap the client/agency sentence → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    const texting = async () => (notesIn(cardOf(await page(), "includes")[0])[2]!.props as { state: string; sentence: string });
    expect(m["surface.texting.texting_registered"]).not.toMatch(/send|sent|go out|deliver/i);
    facts.fn.mockResolvedValue(OK_FACTS({ a2pStatus: "pending" }));
    expect(await texting()).toMatchObject({ state: "waiting", sentence: m["surface.texting.carrier_review"] });
    expect(m["surface.texting.carrier_review"]).toContain("phone carriers");
    expect(m["surface.texting.carrier_review"]).not.toMatch(/A2P|10DLC/i);
    facts.fn.mockResolvedValue(OK_FACTS({ a2pStatus: "not_started" }));
    expect(await texting()).toMatchObject({ state: "needs_setup", sentence: m["surface.texting.setting_up"] });
    guard.isAgency = true;
    expect(await texting()).toMatchObject({ state: "needs_setup", sentence: m["surface.texting.not_registered.agency"] });
    facts.fn.mockResolvedValue(OK_FACTS({ a2pStatus: "rejected" }));
    expect(await texting()).toMatchObject({ sentence: m["surface.texting.registration_rejected.agency"] });
    guard.isAgency = false;
    // The client never reads the agency's instructions: rejected tells them it has to be sent again.
    expect(await texting()).toMatchObject({ state: "needs_setup", sentence: m["surface.texting.registration_rejected"] });
    expect(m["surface.texting.registration_rejected"]).toContain("sent to them again");
    expect(m["surface.texting.registration_rejected"]).not.toContain("Checklist");
  });

  it("a plan that ENDED reads the ended words for Sofía and the chat, never 'until your account's payment is settled' (mutation: drop the cause check in capabilities.ts → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, subscriptionStatus: "canceled" });
    const ended = (cause: "ended" | "payment") => OK_FACTS({
      verdict: { paused: true, voice: false, concierge: false, forward: false, cause }, numberStatuses: [], conciergeLive: false,
    });
    const sentences = async () => notesIn(cardOf(await page(), "includes")[0]).map((n) => (n.props as { sentence: string }).sentence).slice(0, 2);
    facts.fn.mockResolvedValue(ended("ended"));
    expect(await sentences()).toEqual([m["surface.sofia.billing_ended"], m["surface.chat.billing_ended"]]);
    guard.isAgency = true;
    expect(await sentences()).toEqual([m["surface.sofia.billing_ended.agency"], m["surface.chat.billing_ended.agency"]]);
    guard.isAgency = false;
    facts.fn.mockResolvedValue(ended("payment"));
    expect(await sentences()).toEqual([m["surface.sofia.billing_paused"], m["surface.chat.billing_paused"]]);
  });

  it("no support address set: the ask names who to ask and has no mailto link (mutation: build mailto: from an empty address → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", "");
    try {
      dbm.getAccountBilling.mockResolvedValue(PAID);
      facts.fn.mockResolvedValue(OK_FACTS(NO_VOICE));
      const [card] = cardOf(await page(), "bigger");
      expect(find(card, "a")).toHaveLength(0);
      expect(text(card)).toContain(m["billing.bigger.askNoContact"]);
    } finally { vi.unstubAllEnvs(); }
  });

  it("a business with no brand name still gets a subject, never accounts.name or 'null' (mutation: interpolate the raw value → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", SUPPORT);
    try {
      brand.name = null;
      dbm.getAccountBilling.mockResolvedValue(PAID);
      facts.fn.mockResolvedValue(OK_FACTS(NO_VOICE));
      const [link] = find(cardOf(await page(), "bigger")[0], "a");
      expect((link!.props as { href: string }).href).toBe(`mailto:${SUPPORT}?subject=${encodeURIComponent("Plan change")}`);
    } finally { vi.unstubAllEnvs(); }
  });

  it("the client reads 'BIS is setting up' and no link; the agency reads where to fix it (reader words)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    facts.fn.mockResolvedValue(OK_FACTS({ profile: null, numberStatuses: [] }));
    const client = notesIn(cardOf(await page(), "includes")[0])[0]!.props as { sentence: string; link?: { href: string } };
    expect(client.sentence).toBe(m["surface.sofia.setting_up"]);
    expect(client.link).toBeUndefined();
    guard.isAgency = true;
    const agency = notesIn(cardOf(await page(), "includes")[0])[0]!.props as { sentence: string; link?: { href: string } };
    expect(agency.sentence).toBe(m["surface.sofia.sofia_off.agency"]);
    expect(agency.link?.href).toBe("/dashboard/accounts/a/voice");
  });

  it("reads in Spanish for a Spanish reader: titles, sentences, the ask and its subject; and pseudo wraps them (mutation: read m[key] directly → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", SUPPORT);
    try {
      prefs.language = "es";
      dbm.getAccountBilling.mockResolvedValue(PAID);
      facts.fn.mockResolvedValue(OK_FACTS(NO_VOICE));
      const tree = await page();
      const words = text(tree);
      for (const k of ["billing.includes.title.es", "billing.bigger.title.es", "billing.bigger.sofia.es"] as const) expect(words).toContain(m[k]);
      const notes = notesIn(cardOf(tree, "includes")[0]);
      expect((notes[0]!.props as { sentence: string }).sentence).toBe(m["surface.sofia.plan_no_voice.es"]);
      expect((notes[0]!.props as { locale: string }).locale).toBe("es");
      const [link] = find(cardOf(tree, "bigger")[0], "a");
      expect((link!.props as { href: string }).href).toBe(`mailto:${SUPPORT}?subject=${encodeURIComponent("Cambio de plan para Rio Roofing")}`);
    } finally { vi.unstubAllEnvs(); }
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      prefs.language = null;
      const { pseudoLocale } = await import("@/lib/i18n/pseudo-locale");
      const tree = await page({ locale: "pseudo" });
      expect(text(tree)).toContain(pseudoLocale(m["billing.bigger.sofia"]));
      expect((notesIn(cardOf(tree, "includes")[0])[0]!.props as { sentence: string }).sentence).toBe(pseudoLocale(m["surface.sofia.plan_no_voice"]));
    } finally { vi.unstubAllEnvs(); }
  });

  it("no primary button in either new card (rule 8): the ask is a ghost link, never a Button (mutation: render the ask as a Button → FAILS)", async () => {
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", SUPPORT);
    try {
      dbm.getAccountBilling.mockResolvedValue(PAID);
      facts.fn.mockResolvedValue(OK_FACTS(NO_VOICE));
      const tree = await page();
      for (const id of ["includes", "bigger"] as const) {
        const [card] = cardOf(tree, id);
        expect(find(card, Button), id).toHaveLength(0);
        expect(find(card, "button"), id).toHaveLength(0);
      }
      expect(find(tree, ManageBillingButton)).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); }
  });

  it("the guard still runs first: Staff (or another account) reads no capability facts (mutation: read facts before the guard → FAILS)", async () => {
    guard.allowed = false;
    await expect(page()).rejects.toThrow("NEXT_REDIRECT");
    expect(facts.fn).not.toHaveBeenCalled();
  });
});
