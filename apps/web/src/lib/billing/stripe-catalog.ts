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

/** Every meter's id, matched by its EXACT event name (never a prefix — a
 *  retired dashboard meter like `bis_sms_segments_old` sitting ahead of the
 *  real `bis_sms_segments` in the list must never be picked up: the sms
 *  price would end up on the wrong meter and overage would never be
 *  billed), creating any that is missing. The idempotency key covers both
 *  parameters `createMeter` sends (event name and display name), so two
 *  saves racing on a fresh account make one meter and a changed display
 *  name is never handed a stale key. */
export async function ensureMeters(gateway: BillingGateway): Promise<Record<MeterKey, string>> {
  const active = await gateway.listActiveMeters();
  const out = {} as Record<MeterKey, string>;
  for (const key of METER_KEYS) {
    const { eventName, displayName } = METERS[key];
    const found = active.find((m) => m.eventName === eventName);
    out[key] = found
      ? found.id
      : (await gateway.createMeter(
          { eventName, displayName },
          `bis-meter-${eventName}-${shortHash(displayName)}`,
        )).id;
  }
  return out;
}

/** First 16 hex chars of the SHA-256 of a short string (UTF-8) — used to
 *  fold a non-id parameter (a plan's name, a meter's display name) into an
 *  idempotency key so the key covers every parameter its call sends. A
 *  failed first save retried with a different value (same planId/meter,
 *  same draftId) would otherwise reuse a key with different parameters and
 *  Stripe (and the strict FakeGateway) would refuse it forever, per the
 *  Task 4 review corrections (2026-09-25). Server-side only — `node:crypto`,
 *  never bundled to the client. */
function shortHash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

/** What the plan's Stripe objects were built FROM: the stored row, or null for a new plan. */
export type StripeState = { terms: PlanTerms; productId: string; priceIds: StripePriceIds } | null;

/**
 * Makes Stripe match `terms` and returns the ids to store. Creates only
 * what changed:
 *   - the product once (new plan); for an existing plan its name is SET to
 *     `terms.name` on every save (see the rename below);
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
 *
 * Every idempotency key here also expires on Stripe's side after roughly
 * 24 hours (Stripe's own documented retention window). A retry mounted
 * after that window, with no plan row ever having been written (the save
 * that minted the key failed before the database write), creates a fresh,
 * unreferenced product/price set rather than replaying the expired one —
 * an orphan, same as the same-day case this module already accepts, and
 * harmless to money since nothing customer-facing points at it.
 *
 * The same window cuts the other way after a Stripe SERVER error. Stripe
 * stores the first response for a key, a 500 included, and replays it for
 * every retry that sends the same key within those ~24 hours. Because every
 * key here is derived from the terms, a same-terms retry after a Stripe 500
 * keeps failing with the stored 500 until the key expires or the terms
 * change (which derives a new key). That is why the save's failure copy
 * (plans.error.stripeFailed) promises no timeframe.
 */
export async function syncPlanToStripe(
  gateway: BillingGateway, planId: string, terms: PlanTerms, current: StripeState,
): Promise<{ productId: string; priceIds: StripePriceIds }> {
  const meterIds = await ensureMeters(gateway);

  const productId = current
    ? current.productId
    : (await gateway.createProduct(
        { planId, name: terms.name },
        `bis-plan-${planId}-product-${shortHash(terms.name)}`,
      )).id;

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

  // Named LAST, only once every price this save needs has been created
  // successfully. Renaming first (the original order) would let a later
  // createPrice failure leave Stripe showing the new name while the
  // database — written only after this whole function resolves — still
  // holds the old one.
  //
  // And ALWAYS for an existing plan, never only when the name differs from
  // the row's: a rename can reach Stripe and then lose its database write
  // (stale, name taken, a crash), leaving Stripe ahead of the row. Every
  // later save compares against the row, so a rename-on-difference rule
  // would never put Stripe back, and invoices show the product name.
  // Setting a name is idempotent, so the cost is one Stripe call per save.
  if (current) await gateway.renameProduct(productId, terms.name);

  return { productId, priceIds };
}
