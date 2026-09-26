import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { AccountBilling, Plan } from "@bis/db";

const guard = vi.hoisted(() => ({ allowed: true, order: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => { guard.order.push("guard"); if (!guard.allowed) throw new Error("NEXT_REDIRECT"); return { userId: "u", isAgency: false }; },
}));
const dbm = vi.hoisted(() => ({ getAccountBilling: vi.fn(), getPlan: vi.fn(), sumUsageSince: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbm, serviceDb: () => ({ tag: "service" }),
}));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    guard.order.push("db");
    return { tag: "rls", from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }) }; return c; } };
  },
}));
vi.mock("./actions", () => ({ openBillingPortalAction: async () => ({ ok: false, error: "x" }) }));

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

const PLAN = { id: "p1", agencyId: "ag", name: "Growth", monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true }, allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 }, stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "", updatedAt: "" } as Plan;
const PAID = { accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, billingStartedAt: "", createdAt: "", updatedAt: "" } as AccountBilling;
const page = () => BillingPage({ params: Promise.resolve({ accountId: "a" }) });

beforeEach(() => {
  guard.allowed = true;
  guard.order = [];
  for (const f of Object.values(dbm)) f.mockReset();
  dbm.getPlan.mockResolvedValue(PLAN);
  dbm.sumUsageSince.mockResolvedValue({ voice_minutes: 312, sms: 0, ai_chats: 0 });
});

describe("the client Billing page", () => {
  it("requireAccountAccess runs before anything is read: another account's id never reads a row (mutation: read first → FAILS)", async () => {
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
});
