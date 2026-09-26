import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// A switchable flag, not a fixed `isAgency: false`: a fixed stub can never
// exercise the agency branch, so `audience={isAgency ? "agency" : "client"}`
// could be replaced by a hard-coded "client" and every test here would still
// pass (Opus review of 2223893).
const auth = vi.hoisted(() => ({ isAgency: false }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "u", isAgency: auth.isAgency }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({ from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { id: "a", name: "A" }, error: null }) }; return c; } }),
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

// A BLOCK body, not `() => billing.read.mockReset()`: vitest treats a
// function returned from beforeEach as that test's teardown, and mockReset
// returns the mock itself, which would then be CALLED after the test (the
// plan review saw exactly that: `Error: getAccountBilling failed: timeout`).
beforeEach(() => {
  billing.read.mockReset();
  auth.isAgency = false;
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
    expect((tree as ReactElement<{ children: ReactNode[] }>).props.children).toContain("page");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
