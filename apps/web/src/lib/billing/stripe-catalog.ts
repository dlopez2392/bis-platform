import { createHash } from "node:crypto";
import { METER_KEYS, type MeterKey, type PlanTerms, type StripePriceIds } from "@bis/db";
import type { BillingGateway } from "./stripe-gateway";

/**
 * The three Stripe Billing Meters every plan's metered prices hang off. ONE
 * set for the whole Stripe account, found by event name, never one set per
 * plan: usage is reported per CUSTOMER, and the customer's subscription
 * decides which price (and so which allowance) it lands on. The event
 * names are PERMANENT: step 2's usage reporter sends exactly these.
 */
export const METERS: Record<MeterKey, { eventName: string; displayName: string }> = {
  voice_minutes: { eventName: "bis_voice_minutes", displayName: "Voice minutes" },
  sms: { eventName: "bis_sms_segments", displayName: "Text message segments" },
  ai_chats: { eventName: "bis_ai_chats", displayName: "Website chat conversations" },
};

/** Every meter's id, creating any that is missing. The idempotency key is
 *  the event name, so two saves racing on a fresh account make one meter. */
export async function ensureMeters(gateway: BillingGateway): Promise<Record<MeterKey, string>> {
  const active = await gateway.listActiveMeters();
  const out = {} as Record<MeterKey, string>;
  for (const key of METER_KEYS) {
    const { eventName, displayName } = METERS[key];
    const found = active.find((m) => m.eventName === eventName);
    out[key] = found
      ? found.id
      : (await gateway.createMeter({ eventName, displayName }, `bis-meter-${eventName}`)).id;
  }
  return out;
}

/** First 16 hex chars of the SHA-256 of the plan name (UTF-8), so the
 *  product idempotency key covers the one non-id parameter `createProduct`
 *  sends. Without this, a failed first save retried under a new name (same
 *  planId = same draftId) would reuse the bare `bis-plan-<id>-product` key
 *  with different parameters and Stripe (and the strict FakeGateway) would
 *  refuse it forever, per the Task 4 review corrections (2026-09-25).
 *  Server-side only — `node:crypto`, never bundled to the client. */
function nameHash(name: string): string {
  return createHash("sha256").update(name, "utf8").digest("hex").slice(0, 16);
}

/** What the plan's Stripe objects were built FROM: the stored row, or null for a new plan. */
export type StripeState = { terms: PlanTerms; productId: string; priceIds: StripePriceIds } | null;

/**
 * Makes Stripe match `terms` and returns the ids to store. Creates only
 * what changed:
 *   - the product once (new plan), renamed when the name changes;
 *   - a new base price when the monthly price changes;
 *   - a new metered price for a meter whose allowance OR overage changes.
 * Old prices are left as they are: subscriptions on them keep them until
 * moved (spec section 2; assumption A6).
 *
 * Idempotency keys are the plan id, the product id (once known) and
 * EXACTLY the parameters the call sends — never fewer, so equal key implies
 * equal parameters (Task 4 review corrections, 2026-09-25): the product key
 * carries a hash of the name, and every price key carries the product id
 * (and, for a metered price, the meter id) so a retry after a rename can
 * never be handed a price replay still attached to the OLD product. A retry
 * of the same save (a lost response, a double click) therefore replays the
 * objects already made instead of duplicating them, and a retry with
 * DIFFERENT terms can never be handed an old price.
 *
 * Throws on any Stripe failure. The caller writes the database only after
 * this resolves, so a failure leaves the database exactly as it was.
 */
export async function syncPlanToStripe(
  gateway: BillingGateway, planId: string, terms: PlanTerms, current: StripeState,
): Promise<{ productId: string; priceIds: StripePriceIds }> {
  const meterIds = await ensureMeters(gateway);

  const productId = current
    ? current.productId
    : (await gateway.createProduct(
        { planId, name: terms.name },
        `bis-plan-${planId}-product-${nameHash(terms.name)}`,
      )).id;
  if (current && current.terms.name !== terms.name) await gateway.renameProduct(productId, terms.name);

  const base = current && current.terms.monthlyPriceCents === terms.monthlyPriceCents
    ? current.priceIds.base
    : (await gateway.createPrice(
        { kind: "base", planId, productId, unitAmountCents: terms.monthlyPriceCents },
        `bis-plan-${planId}-${productId}-base-${terms.monthlyPriceCents}`,
      )).id;

  const priceIds: StripePriceIds = { base, voice_minutes: "", sms: "", ai_chats: "" };
  for (const meter of METER_KEYS) {
    const allowance = terms.allowances[meter];
    const overageCents = terms.overageCents[meter];
    const meterId = meterIds[meter];
    const unchanged = current !== null
      && current.terms.allowances[meter] === allowance
      && current.terms.overageCents[meter] === overageCents;
    priceIds[meter] = unchanged
      ? current.priceIds[meter]
      : (await gateway.createPrice(
          { kind: "metered", planId, productId, meter, meterId, allowance, overageCents },
          `bis-plan-${planId}-${productId}-${meter}-${meterId}-${allowance}-${overageCents}`,
        )).id;
  }
  return { productId, priceIds };
}
