import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The account layout (the payment-failed banner) and the Billing page both
 * need the account_billing row on the same navigation. They must read it
 * through the ONE cached seam, `readAccountBilling`, so a visit to Billing
 * costs one query, not two (plan corrections, "Task 11 → later tasks").
 * `cache()` only dedupes callers of the SAME wrapped function, so a reader
 * that calls `getAccountBilling` directly is a second query even though
 * the seam is cached.
 */
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "u", isAgency: false }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    tag: "rls",
    from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { id: "a", name: "A", timezone: "America/Chicago" }, error: null }) }; return c; },
  }),
}));
const seam = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/billing/account-billing-read", () => ({ readAccountBilling: seam.read }));
const direct = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), getAccountBilling: direct.read }));
vi.mock("./actions", () => ({ openBillingPortalAction: async () => ({ ok: false, error: "x" }) }));

const { default: Layout } = await import("../layout");
const { default: BillingPage } = await import("./page");

beforeEach(() => {
  seam.read.mockReset();
  seam.read.mockResolvedValue(null);
  direct.read.mockReset();
});

describe("the billing row on one navigation", () => {
  it("the layout and the Billing page both read it through readAccountBilling, never getAccountBilling directly (mutation: the layout or the page calls getAccountBilling(db, id) → FAILS)", async () => {
    await Layout({ children: "page", params: Promise.resolve({ accountId: "a" }) });
    expect(seam.read.mock.calls).toEqual([["a"]]);
    await BillingPage({ params: Promise.resolve({ accountId: "a" }) });
    expect(seam.read.mock.calls).toEqual([["a"], ["a"]]);
    expect(direct.read).not.toHaveBeenCalled();
  });
});
