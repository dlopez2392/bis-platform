import { describe, it, expect, vi } from "vitest";
import { FakeGateway } from "./fake-gateway";
import { ensurePortalConfiguration, openPortal } from "./portal";
import { PORTAL_FEATURES, PORTAL_VERSION, type PortalConfiguration } from "./stripe-gateway";

/** A configuration as listPortalConfigurations returns it: BIS's own
 *  features (card + invoices only, DECISION 3) unless overridden. */
const config = (id: string, metadata: Record<string, string>, features: Partial<PortalConfiguration["features"]> = {}): PortalConfiguration => ({
  id, metadata,
  features: {
    invoice_history: true, payment_method_update: true, customer_update: false,
    subscription_cancel: false, subscription_update: false, ...features,
  },
});

describe("the Customer Portal (G19)", () => {
  it("reuses BIS's tagged configuration and creates nothing (mutation: always create → a new configuration per click, FAILS)", async () => {
    const fake = new FakeGateway();
    fake.portalConfigurations = [config("bpc_other", {}), config("bpc_ours", { bis_portal: PORTAL_VERSION })];
    expect(await ensurePortalConfiguration(fake)).toBe("bpc_ours");
    expect(fake.calls.map((c) => c.op)).toEqual(["listPortalConfigurations"]);
  });

  it("creates it once when missing, under a key that replays: two first-clicks at once make ONE configuration (mutation: a random key → two, FAILS)", async () => {
    const fake = new FakeGateway();
    const [a, b] = await Promise.all([ensurePortalConfiguration(fake), ensurePortalConfiguration(fake)]);
    expect(a).toBe(b);
    expect(fake.portalConfigurations).toHaveLength(1);
  });

  it.each(PORTAL_FEATURES)("never uses a tagged configuration whose %s was flipped in the Stripe dashboard (self-cancel on breaks DECISION 3, card updates off leave Manage billing useless): it makes a fresh card-and-invoices one, says which it passed over, and uses that from then on (review correction 3) (mutation: match on the tag alone → the client's portal offers cancel, FAILS; leave this feature out of the drift check → FAILS; key the replacement like the first create → Stripe replays the drifted one, FAILS)", async (feature) => {
    const fake = new FakeGateway();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // The first-ever create happened (same key the missing case uses), then
    // someone flipped one feature on it in the dashboard.
    const first = await ensurePortalConfiguration(fake);
    const drifted = fake.portalConfigurations[0]!.features;
    drifted[feature] = !drifted[feature];

    const replaced = await ensurePortalConfiguration(fake);
    expect(replaced).not.toBe(first);
    expect(fake.portalConfigurations.find((c) => c.id === replaced)!.features).toEqual(config("x", {}).features);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(new RegExp(`${first}.*${feature}`));

    fake.calls.length = 0;
    expect(await ensurePortalConfiguration(fake)).toBe(replaced);
    expect(fake.calls.map((c) => c.op)).toEqual(["listPortalConfigurations"]);
    log.mockRestore();
  });

  it("opens a session for the customer on BIS's configuration, returning where the caller asked (mutation: omit the configuration → the account's default portal, with self-cancel if enabled there, FAILS)", async () => {
    const fake = new FakeGateway();
    const url = await openPortal(fake, { customerId: "cus_1", returnUrl: "https://app.example/dashboard/accounts/a/billing" });
    expect(url).toBe("https://billing.stripe.test/p/session/cus_1");
    expect(fake.portalSessions).toEqual([{
      customerId: "cus_1", returnUrl: "https://app.example/dashboard/accounts/a/billing", configurationId: fake.portalConfigurations[0]!.id,
    }]);
  });
});
