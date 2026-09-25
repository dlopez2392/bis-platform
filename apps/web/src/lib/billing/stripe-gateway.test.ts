import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import {
  billingGatewayFromEnv, priceCreateParams, stripeGateway, stripeKeyVerdict, STRIPE_API_VERSION,
} from "./stripe-gateway";
import { FakeGateway } from "./fake-gateway";

/**
 * The seam between BIS and Stripe. The mapping to Stripe's parameters is
 * the money logic, so it is asserted as exact objects. The adapter is
 * driven through a stub Stripe client that records calls, so these tests
 * never touch the network. e2e/plans.spec.ts is the proof against real
 * Stripe test mode.
 */

// Hoisted so the vi.mock factory below (itself hoisted above these imports
// by vitest) can close over it. Lets the `billingGatewayFromEnv` happy path
// assert WHICH key and WHICH apiVersion the real `Stripe` constructor was
// called with, without any network call — the constructor never makes one.
const { stripeCtorSpy } = vi.hoisted(() => ({ stripeCtorSpy: vi.fn() }));
vi.mock("stripe", () => ({
  default: class {
    billing = { meters: { list: vi.fn(), create: vi.fn() } };
    products = { create: vi.fn(), update: vi.fn() };
    prices = { create: vi.fn() };
    constructor(...args: unknown[]) {
      stripeCtorSpy(...args);
    }
  },
}));

function stubStripe(overrides: { hasMore?: boolean } = {}) {
  return {
    billing: {
      meters: {
        list: vi.fn(async () => ({
          data: [{ id: "mtr_sms", event_name: "bis_sms_segments" }], has_more: overrides.hasMore ?? false,
        })),
        create: vi.fn(async (p: { event_name: string }) => ({ id: "mtr_new", event_name: p.event_name })),
      },
    },
    products: {
      create: vi.fn(async () => ({ id: "prod_new" })),
      update: vi.fn(async () => ({ id: "prod_1" })),
    },
    // Extra fields beyond `id` on purpose: pins that `createPrice` returns
    // exactly `{ id }`, never the raw Stripe price object (plan-review note b).
    prices: { create: vi.fn(async () => ({ id: "price_new", object: "price", livemode: false, unit_amount: 3 })) },
  };
}

const metered = (allowance: number) => ({
  kind: "metered" as const, planId: "plan_1", productId: "prod_1", meter: "sms" as const,
  meterId: "mtr_sms", allowance, overageCents: 3,
});

describe("priceCreateParams (the money mapping)", () => {
  it("base: a licensed monthly price in USD cents (mutation: usage_type 'metered' on the base → FAILS)", () => {
    expect(priceCreateParams({ kind: "base", planId: "plan_1", productId: "prod_1", unitAmountCents: 4900 })).toEqual({
      product: "prod_1", currency: "usd", unit_amount: 4900,
      recurring: { interval: "month", usage_type: "licensed" },
      metadata: { bis_plan_id: "plan_1", bis_price: "base" },
    });
  });

  it("metered with an allowance: GRADUATED tiers, the allowance free, then the overage per unit (mutation: tiers_mode 'volume' → FAILS; volume would bill every unit once past the allowance)", () => {
    expect(priceCreateParams(metered(1000))).toEqual({
      product: "prod_1", currency: "usd", billing_scheme: "tiered", tiers_mode: "graduated",
      tiers: [{ up_to: 1000, unit_amount: 0 }, { up_to: "inf", unit_amount: 3 }],
      recurring: { interval: "month", usage_type: "metered", meter: "mtr_sms" },
      metadata: { bis_plan_id: "plan_1", bis_price: "sms" },
    });
  });

  it("metered with a ZERO allowance: a plain per-unit price, no tiers (mutation: emit tiers with up_to 0 → FAILS; Stripe refuses a 0 tier, assumption A1)", () => {
    expect(priceCreateParams(metered(0))).toEqual({
      product: "prod_1", currency: "usd", unit_amount: 3,
      recurring: { interval: "month", usage_type: "metered", meter: "mtr_sms" },
      metadata: { bis_plan_id: "plan_1", bis_price: "sms" },
    });
  });

  it("rejects a non-integer base unitAmountCents before it can reach Stripe (mutation: drop the Number.isInteger check on unitAmountCents → FAILS)", () => {
    expect(() => priceCreateParams({ kind: "base", planId: "plan_1", productId: "prod_1", unitAmountCents: 49.5 }))
      .toThrow(/unitAmountCents/);
  });

  it("rejects a zero or negative base unitAmountCents (mutation: allow unitAmountCents <= 0 on the base → FAILS)", () => {
    expect(() => priceCreateParams({ kind: "base", planId: "plan_1", productId: "prod_1", unitAmountCents: 0 }))
      .toThrow(/unitAmountCents/);
    expect(() => priceCreateParams({ kind: "base", planId: "plan_1", productId: "prod_1", unitAmountCents: -100 }))
      .toThrow(/unitAmountCents/);
  });

  it("rejects a non-integer metered allowance (mutation: drop the allowance guard → FAILS)", () => {
    expect(() => priceCreateParams(metered(10.5))).toThrow(/allowance/);
  });

  it("rejects a negative metered overageCents (mutation: drop the overageCents guard → FAILS)", () => {
    expect(() => priceCreateParams({ ...metered(1000), overageCents: -1 })).toThrow(/overageCents/);
  });
});

describe("stripeGateway (the adapter)", () => {
  it("createPrice sends the mapped params AND the idempotency key, and returns exactly { id } (mutation: drop the options argument → FAILS; mutation: return the raw stripe price object → FAILS)", async () => {
    const s = stubStripe();
    const r = await stripeGateway(s as unknown as Stripe).createPrice(metered(1000), "key-price");
    expect(r).toEqual({ id: "price_new" });
    expect(s.prices.create).toHaveBeenCalledWith(priceCreateParams(metered(1000)), { idempotencyKey: "key-price" });
  });

  it("createProduct names the product and tags it with the plan id, under the idempotency key, and returns the Stripe-minted id (mutation: drop metadata → FAILS; mutation: return { id: planId } → FAILS)", async () => {
    const s = stubStripe();
    const r = await stripeGateway(s as unknown as Stripe).createProduct({ planId: "plan_1", name: "Growth" }, "key-prod");
    expect(r).toEqual({ id: "prod_new" });
    expect(s.products.create).toHaveBeenCalledWith({ name: "Growth", metadata: { bis_plan_id: "plan_1" } }, { idempotencyKey: "key-prod" });
  });

  it("createMeter SUMS a value, maps customers by stripe_customer_id (mutation: formula 'count' → FAILS; count bills per event, not per minute)", async () => {
    const s = stubStripe();
    const m = await stripeGateway(s as unknown as Stripe).createMeter({ eventName: "bis_voice_minutes", displayName: "Voice minutes" }, "key-meter");
    expect(m).toEqual({ id: "mtr_new", eventName: "bis_voice_minutes" });
    expect(s.billing.meters.create).toHaveBeenCalledWith({
      display_name: "Voice minutes", event_name: "bis_voice_minutes",
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    }, { idempotencyKey: "key-meter" });
  });

  it("listActiveMeters asks for ACTIVE meters and maps event names (mutation: drop status → FAILS)", async () => {
    const s = stubStripe();
    expect(await stripeGateway(s as unknown as Stripe).listActiveMeters()).toEqual([{ id: "mtr_sms", eventName: "bis_sms_segments" }]);
    expect(s.billing.meters.list).toHaveBeenCalledWith({ status: "active", limit: 100 });
  });

  it("listActiveMeters refuses to guess past one page (mutation: ignore has_more → resolves, FAILS)", async () => {
    await expect(stripeGateway(stubStripe({ hasMore: true }) as unknown as Stripe).listActiveMeters())
      .rejects.toThrow(/more than 100 active meters/);
  });

  it("renameProduct changes the name and nothing else (mutation: send active:false too → FAILS)", async () => {
    const s = stubStripe();
    await stripeGateway(s as unknown as Stripe).renameProduct("prod_1", "Growth Plus");
    expect(s.products.update).toHaveBeenCalledWith("prod_1", { name: "Growth Plus" });
  });
});

describe("stripeKeyVerdict (a live key never runs outside production)", () => {
  it.each<[string, { STRIPE_SECRET_KEY?: string; VERCEL_ENV?: string }, ReturnType<typeof stripeKeyVerdict>]>([
    ["no key", {}, { ok: false, reason: "missing" }],
    ["a blank key", { STRIPE_SECRET_KEY: "   " }, { ok: false, reason: "missing" }],
    ["a test key on a preview", { STRIPE_SECRET_KEY: "sk_test_a", VERCEL_ENV: "preview" }, { ok: true, key: "sk_test_a" }],
    ["a restricted test key locally", { STRIPE_SECRET_KEY: "rk_test_b" }, { ok: true, key: "rk_test_b" }],
    ["a live key in production", { STRIPE_SECRET_KEY: "sk_live_c", VERCEL_ENV: "production" }, { ok: true, key: "sk_live_c" }],
    ["a live key on a preview", { STRIPE_SECRET_KEY: "sk_live_d", VERCEL_ENV: "preview" }, { ok: false, reason: "live_key_outside_production" }],
    ["a restricted live key locally", { STRIPE_SECRET_KEY: "rk_live_e" }, { ok: false, reason: "live_key_outside_production" }],
    ["a publishable key", { STRIPE_SECRET_KEY: "pk_test_f" }, { ok: false, reason: "not_a_secret_key" }],
    ["a webhook secret", { STRIPE_SECRET_KEY: "whsec_g" }, { ok: false, reason: "not_a_secret_key" }],
  ])("%s (mutation: drop the VERCEL_ENV comparison → the live-key rows FAIL)", (_label, env, expected) => {
    expect(stripeKeyVerdict(env)).toEqual(expected);
  });
});

describe("billingGatewayFromEnv", () => {
  it("reports why there is no gateway instead of constructing one (mutation: construct with an empty key → FAILS)", () => {
    stripeCtorSpy.mockClear();
    expect(billingGatewayFromEnv({})).toEqual({ ok: false, reason: "missing" });
    expect(stripeCtorSpy).not.toHaveBeenCalled();
  });

  it("builds a working gateway from a test key, constructing Stripe with the TRIMMED key and the pinned API version (mutation: pass the raw untrimmed key to the constructor → FAILS; mutation: bypass the verdict, or use a different apiVersion → FAILS)", () => {
    stripeCtorSpy.mockClear();
    const g = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "  sk_test_UNIT  " });
    expect(g.ok).toBe(true);
    expect(g.ok && typeof g.gateway.createPrice).toBe("function");
    expect(stripeCtorSpy).toHaveBeenCalledWith("sk_test_UNIT", expect.objectContaining({ apiVersion: STRIPE_API_VERSION }));
  });

  it("never constructs Stripe for a live key outside production, even through the function the app actually calls (mutation: return early only for 'missing' → FAILS)", () => {
    stripeCtorSpy.mockClear();
    const g = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_live_UNIT", VERCEL_ENV: "preview" });
    expect(g).toEqual({ ok: false, reason: "live_key_outside_production" });
    expect(stripeCtorSpy).not.toHaveBeenCalled();
  });
});

describe("FakeGateway idempotency (must be at least as strict as Stripe, assumption A4)", () => {
  it("a key reused with the SAME op and SAME input replays the first result without minting a new object (mutation: always mint a new id on replay → FAILS)", async () => {
    const g = new FakeGateway();
    const first = await g.createProduct({ planId: "plan_1", name: "Growth" }, "key-1");
    const second = await g.createProduct({ planId: "plan_1", name: "Growth" }, "key-1");
    expect(second).toEqual(first);
    expect(g.created).toHaveLength(1);
  });

  it("a key reused with DIFFERENT input for the same op throws instead of replaying (mutation: replay without comparing input → FAILS)", async () => {
    const g = new FakeGateway();
    await g.createProduct({ planId: "plan_1", name: "Growth" }, "key-1");
    await expect(g.createProduct({ planId: "plan_1", name: "Growth Renamed" }, "key-1"))
      .rejects.toThrow(/idempotency/i);
  });

  it("a key reused for a DIFFERENT operation throws even when the input happens to be the same object (mutation: compare input only, not op → FAILS)", async () => {
    // Same input object by reference on purpose (cast past the differing
    // per-op input shapes) so this isolates the op comparison specifically:
    // an input-only check would call these "the same" and replay.
    const g = new FakeGateway();
    const sharedInput = { planId: "plan_1", name: "Growth" };
    await g.createProduct(sharedInput, "key-1");
    await expect(g.createMeter(sharedInput as unknown as { eventName: string; displayName: string }, "key-1"))
      .rejects.toThrow(/idempotency/i);
  });

  it("createPrice enforces the same money guard as the real gateway, so a float reaches nobody (mutation: fake's createPrice skips priceCreateParams/the guard → FAILS)", async () => {
    const g = new FakeGateway();
    await expect(g.createPrice({ kind: "base", planId: "plan_1", productId: "prod_1", unitAmountCents: 49.5 }, "key-1"))
      .rejects.toThrow(/unitAmountCents/);
  });
});
