import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { PlanTerms } from "@bis/db";
import { FakeGateway } from "./fake-gateway";
import { METERS, ensureMeters, syncPlanToStripe, type StripeState } from "./stripe-catalog";

const PLAN = "11111111-1111-4111-8111-111111111111";
const TERMS: PlanTerms = {
  name: "Growth", monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: false },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
};
const EXISTING_METERS = [
  { id: "mtr_vm", eventName: "bis_voice_minutes" },
  { id: "mtr_sms", eventName: "bis_sms_segments" },
  { id: "mtr_ai", eventName: "bis_ai_chats" },
];
const CURRENT: StripeState = {
  terms: TERMS, productId: "prod_existing",
  priceIds: { base: "price_base_old", voice_minutes: "price_vm_old", sms: "price_sms_old", ai_chats: "price_ai_old" },
};

function fake(withMeters = true): FakeGateway {
  const g = new FakeGateway();
  if (withMeters) g.meters = EXISTING_METERS.map((m) => ({ ...m }));
  return g;
}

const createdOps = (g: FakeGateway) => g.created.map((c) => c.op);

/** Same 16-hex-char SHA-256 prefix the catalog itself derives the product
 *  idempotency key from (review corrections, Task 4 review 2026-09-25). */
function nameHash(name: string): string {
  return createHash("sha256").update(name, "utf8").digest("hex").slice(0, 16);
}

describe("ensureMeters", () => {
  it("creates the three meters under their permanent event names when Stripe has none (mutation: rename bis_sms_segments → FAILS; step 2 reports to these names)", async () => {
    const g = fake(false);
    const ids = await ensureMeters(g);
    expect(g.created.map((c) => (c.input as { eventName: string }).eventName))
      .toEqual(["bis_voice_minutes", "bis_sms_segments", "bis_ai_chats"]);
    expect(Object.keys(ids)).toEqual(["voice_minutes", "sms", "ai_chats"]);
    expect(METERS.sms.eventName).toBe("bis_sms_segments");
  });

  it("reuses active meters and creates none (mutation: always create → FAILS)", async () => {
    const g = fake();
    expect(await ensureMeters(g)).toEqual({ voice_minutes: "mtr_vm", sms: "mtr_sms", ai_chats: "mtr_ai" });
    expect(g.created).toEqual([]);
  });

  // Fix 1 (review finding, 2026-09-25): a dashboard meter named
  // `bis_sms_segments_old`, listed BEFORE the real `bis_sms_segments`, must
  // never be picked up for the sms meter — a prefix match would attach the
  // sms price to the wrong (old) meter and overage would never be billed.
  it("matches a meter by the EXACT event name, never a prefix, even when a decoy is listed first (mutation: match by prefix/startsWith → FAILS)", async () => {
    const g = fake(false);
    g.meters = [
      { id: "mtr_sms_old", eventName: "bis_sms_segments_old" },
      { id: "mtr_sms", eventName: "bis_sms_segments" },
    ];
    const ids = await ensureMeters(g);
    expect(ids.sms).toBe("mtr_sms");
  });

  // Fix 3 (review finding, 2026-09-25): the createMeter idempotency key must
  // cover displayName too, the same rule the product key already follows —
  // otherwise a key collision on a changed display name would be refused by
  // real Stripe (and the strict fake) forever.
  it("meter idempotency keys cover the display name too (mutation: drop the displayName hash from the meter key → FAILS)", async () => {
    const g = fake(false);
    await ensureMeters(g);
    expect(g.calls.filter((c) => c.op === "createMeter").map((c) => c.key)).toEqual([
      `bis-meter-bis_voice_minutes-${nameHash("Voice minutes")}`,
      `bis-meter-bis_sms_segments-${nameHash("Text message segments")}`,
      `bis-meter-bis_ai_chats-${nameHash("Website chat conversations")}`,
    ]);
  });
});

describe("syncPlanToStripe", () => {
  it("a new plan: one product, one monthly price, three metered prices, each on its OWN meter (mutation: swap the sms and ai_chats meter ids → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, TERMS, null);
    expect(createdOps(g)).toEqual(["createProduct", "createPrice", "createPrice", "createPrice", "createPrice"]);
    const specs = g.created.filter((c) => c.op === "createPrice").map((c) => c.input);
    expect(specs).toEqual([
      { kind: "base", planId: PLAN, productId: r.productId, unitAmountCents: 4900 },
      { kind: "metered", planId: PLAN, productId: r.productId, meter: "voice_minutes", meterId: "mtr_vm", allowance: 500, overageCents: 12 },
      { kind: "metered", planId: PLAN, productId: r.productId, meter: "sms", meterId: "mtr_sms", allowance: 1000, overageCents: 3 },
      { kind: "metered", planId: PLAN, productId: r.productId, meter: "ai_chats", meterId: "mtr_ai", allowance: 200, overageCents: 25 },
    ]);
    expect(Object.keys(r.priceIds).sort()).toEqual(["ai_chats", "base", "sms", "voice_minutes"]);
  });

  // REVIEW CORRECTIONS (Task 4 review, 2026-09-25) — BINDING: every
  // idempotency key must cover every parameter the call sends, so equal
  // key ⇔ equal parameters. The product key includes a hash of the name;
  // base and metered price keys include the product id (and, for metered,
  // the meter id) so a retry after a rename can never be handed a price
  // replay attached to the OLD product.
  it("a new plan's idempotency keys are the plan id, product id and exactly the terms each object is built from (mutation: drop the overage from the metered key → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, TERMS, null);
    expect(g.calls.filter((c) => c.key).map((c) => c.key)).toEqual([
      `bis-plan-${PLAN}-product-${nameHash("Growth")}`,
      `bis-plan-${PLAN}-${r.productId}-base-4900`,
      `bis-plan-${PLAN}-${r.productId}-voice_minutes-mtr_vm-500-12`,
      `bis-plan-${PLAN}-${r.productId}-sms-mtr_sms-1000-3`,
      `bis-plan-${PLAN}-${r.productId}-ai_chats-mtr_ai-200-25`,
    ]);
  });

  // Added per REVIEW CORRECTIONS (1): a failed first save (Stripe succeeded,
  // the database write never happened, so `current` is still null on retry)
  // retried with a DIFFERENT name for the SAME planId must succeed against
  // the strict fake, not be refused forever by an idempotency-key clash.
  // The first product is accepted as orphaned (nothing is deactivated here).
  it("a failed first save then a retry with a DIFFERENT name for the same planId succeeds against the fake, orphaning the first product (mutation: drop the name hash from the product key → the fake throws the idempotency mismatch → FAILS)", async () => {
    const g = fake();
    const first = await syncPlanToStripe(g, PLAN, TERMS, null);
    const retried = await syncPlanToStripe(g, PLAN, { ...TERMS, name: "Growth Plus" }, null);
    expect(retried.productId).not.toBe(first.productId);
  });

  // Added per REVIEW CORRECTIONS (2): a retry of the SAME save (identical
  // terms, current still null) must replay every object rather than mint
  // duplicates — the whole point of keying on the terms.
  it("a retry of the same save with identical terms replays — creates no new objects (mutation: add a random/timestamp component to any key → FAILS)", async () => {
    const g = fake();
    const first = await syncPlanToStripe(g, PLAN, TERMS, null);
    const createdAfterFirst = g.created.length;
    const second = await syncPlanToStripe(g, PLAN, TERMS, null);
    expect(g.created.length).toBe(createdAfterFirst);
    expect(second).toEqual(first);
  });

  it("re-saving unchanged terms creates nothing and keeps every id (mutation: drop the unchanged check → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, TERMS, CURRENT);
    expect(g.created).toEqual([]);
    expect(g.calls.some((c) => c.op === "renameProduct")).toBe(false);
    expect(r).toEqual({ productId: "prod_existing", priceIds: CURRENT!.priceIds });
  });

  it("a monthly price change creates exactly one new base price and keeps the three metered ones (mutation: compare allowances for the base → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, { ...TERMS, monthlyPriceCents: 5900 }, CURRENT);
    expect(createdOps(g)).toEqual(["createPrice"]);
    expect(r.priceIds).toEqual({ ...CURRENT!.priceIds, base: g.created[0]!.id });
  });

  it("an overage change on one meter creates exactly that meter's price (mutation: key the unchanged check on allowance only → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, { ...TERMS, overageCents: { ...TERMS.overageCents, sms: 4 } }, CURRENT);
    expect(createdOps(g)).toEqual(["createPrice"]);
    expect(r.priceIds).toEqual({ ...CURRENT!.priceIds, sms: g.created[0]!.id });
  });

  it("an allowance change on one meter creates exactly that meter's price (mutation: key the unchanged check on overage only → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, { ...TERMS, allowances: { ...TERMS.allowances, voice_minutes: 800 } }, CURRENT);
    expect(createdOps(g)).toEqual(["createPrice"]);
    expect(r.priceIds).toEqual({ ...CURRENT!.priceIds, voice_minutes: g.created[0]!.id });
  });

  it("a rename renames the product and creates no price (mutation: skip the rename → FAILS; the invoice would show the old name)", async () => {
    const g = fake();
    await syncPlanToStripe(g, PLAN, { ...TERMS, name: "Growth Plus" }, CURRENT);
    expect(g.calls.filter((c) => c.op === "renameProduct").map((c) => c.input))
      .toEqual([{ productId: "prod_existing", name: "Growth Plus" }]);
    expect(g.created).toEqual([]);
  });

  // Fix 2 (review finding, 2026-09-25): renaming the product BEFORE new
  // prices are created means a later createPrice failure leaves Stripe
  // showing the new name while the database (never written, since the
  // caller writes only after this resolves) keeps the old one. The rename
  // must happen only after every price creation this save needs has
  // succeeded.
  it("a save that renames AND changes a price never renames if price creation fails (mutation: rename before price creation → FAILS)", async () => {
    const g = fake();
    g.failOn = { op: "createPrice" };
    await expect(
      syncPlanToStripe(g, PLAN, { ...TERMS, name: "Growth Plus", monthlyPriceCents: 5900 }, CURRENT),
    ).rejects.toThrow(/fake Stripe refused createPrice/);
    expect(g.calls.some((c) => c.op === "renameProduct")).toBe(false);
  });

  it("a retried new plan with DIFFERENT terms never reuses an old price, while unchanged parts replay (mutation: drop the allowance from the metered key → FAILS)", async () => {
    const g = fake();
    const first = await syncPlanToStripe(g, PLAN, TERMS, null);
    const second = await syncPlanToStripe(g, PLAN, { ...TERMS, allowances: { ...TERMS.allowances, sms: 2000 } }, null);
    expect(second.productId).toBe(first.productId);
    expect(second.priceIds.base).toBe(first.priceIds.base);
    expect(second.priceIds.sms).not.toBe(first.priceIds.sms);
  });

  it("a Stripe failure part-way REJECTS, so the caller writes nothing (mutation: catch and return partial ids → resolves, FAILS)", async () => {
    const g = fake();
    g.failOn = { op: "createPrice", after: 2 };
    await expect(syncPlanToStripe(g, PLAN, TERMS, null)).rejects.toThrow(/fake Stripe refused createPrice/);
  });

  it("meters are ensured BEFORE any product or price exists (mutation: create the product first → a meter failure leaves a product, FAILS)", async () => {
    const g = fake(false);
    g.failOn = { op: "createMeter" };
    await expect(syncPlanToStripe(g, PLAN, TERMS, null)).rejects.toThrow(/createMeter/);
    expect(g.created).toEqual([]);
  });
});
