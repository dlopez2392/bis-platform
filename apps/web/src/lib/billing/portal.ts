import {
  idempotencyKey, portalConfigurationParams, portalFeatureFlags, PORTAL_FEATURES, PORTAL_VERSION,
  type BillingGateway, type PortalConfiguration, type PortalFeature,
} from "./stripe-gateway";

/** The features on which `c` differs from what BIS set (empty = usable). */
function driftOf(c: PortalConfiguration, want: Record<PortalFeature, boolean>): PortalFeature[] {
  return PORTAL_FEATURES.filter((f) => c.features[f] !== want[f]);
}

/**
 * BIS's own portal configuration (G19), found by its tag or created once.
 *
 * A tagged configuration is used only while it still allows EXACTLY card
 * updates and invoice history (DECISION 3). Anyone with dashboard access can
 * edit it after BIS made it, and self-cancel switched on there would reach
 * every client's Manage billing. One that drifted is passed over, named in
 * the log, and replaced: its replacement's key names the configurations it
 * replaces, so Stripe cannot replay the drifted one (the first create's key
 * would, for 24 hours). The drifted one stays in Stripe, unused by BIS.
 *
 * The key hashes the configuration's params, so two first-clicks at once
 * replay one create, and a changed configuration (a new PORTAL_VERSION)
 * makes a new one instead of a 400. Deliberately input-derived, unlike the
 * billing link's per-Send keys, so concurrent first clicks share one
 * configuration. The cost, on an assumption (Stripe's idempotency docs, not
 * re-read here): Stripe saves a 500 under its key and replays it, so a
 * transient error on THIS create would fail every Manage billing click for up
 * to 24 hours. It can happen only while no usable configuration exists: the
 * first click in a Stripe mode, after a PORTAL_VERSION change, or after a
 * drift.
 */
export async function ensurePortalConfiguration(gateway: BillingGateway): Promise<string> {
  const want = portalFeatureFlags();
  const tagged = (await gateway.listPortalConfigurations()).filter((c) => c.metadata.bis_portal === PORTAL_VERSION);
  const usable = tagged.find((c) => driftOf(c, want).length === 0);
  if (usable) return usable.id;
  for (const c of tagged) {
    console.error(
      `portal: configuration ${c.id} is tagged ${PORTAL_VERSION} but its ${driftOf(c, want).join(", ")} no longer match `
        + "BIS's (card updates and invoices only, DECISION 3); it was changed in the Stripe dashboard and is not used. Making a new one.",
    );
  }
  const created = await gateway.createPortalConfiguration(idempotencyKey("bis-portal", PORTAL_VERSION, {
    params: portalConfigurationParams(), replacing: tagged.map((c) => c.id).sort(),
  }));
  return created.id;
}

/** A Customer Portal session URL for the customer, on BIS's configuration. */
export async function openPortal(gateway: BillingGateway, input: { customerId: string; returnUrl: string }): Promise<string> {
  const configurationId = await ensurePortalConfiguration(gateway);
  return (await gateway.createPortalSession({ ...input, configurationId })).url;
}
