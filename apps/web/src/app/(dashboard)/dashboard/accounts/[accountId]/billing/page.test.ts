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
// Echoes the bound locale back as `error` (S-10 T6 test below), rather than
// a fixed "x" — the real action's own shape, with nothing to assert on its
// REAL English/Spanish text here; billing/actions.test.ts already covers that.
vi.mock("./actions", () => ({ openBillingPortalAction: async (_accountId: string, locale?: string) => ({ ok: false, error: locale ?? "x" }) }));

const { default: BillingPage } = await import("./page");
const { EmptyState } = await import("@/components/empty-state");
const { ManageBillingButton } = await import("./manage-billing-button");
const { m } = await import("@/lib/messages");
const { DotPill } = await import("@/components/dot-pill");

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
