import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import type { SubscriptionSnapshot } from "@bis/db";
import {
  billingGatewayFromEnv, priceCreateParams, PRODUCTION_SUPABASE_REF, stripeGateway, stripeKeyVerdict,
  STRIPE_API_VERSION, meterEventParams, meterEventFailureKind, METER_EVENT_TIMEOUT_MS,
  checkoutSessionParams, idempotencyKey, subscriptionSnapshot, portalConfigurationParams, PORTAL_VERSION,
  type StripeEnv, type MeterEventInput,
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

type StubOverrides = {
  hasMore?: boolean;
  /** checkout.sessions.create's `url` (Stripe types it string | null). */
  sessionUrl?: string | null;
  /** checkout.sessions.retrieve's `status`. */
  sessionStatus?: string | null;
  portalHasMore?: boolean;
};

function stubStripe(overrides: StubOverrides = {}) {
  return {
    customers: {
      create: vi.fn(async () => ({ id: "cus_new", object: "customer", email: "owner@example.com" })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_1", object: "checkout.session", status: "open", expires_at: 1_790_086_400,
          url: overrides.sessionUrl === undefined ? "https://checkout.stripe.com/c/pay/cs_1" : overrides.sessionUrl,
        })),
        retrieve: vi.fn(async () => ({
          id: "cs_1", object: "checkout.session", status: overrides.sessionStatus === undefined ? "open" : overrides.sessionStatus,
        })),
        expire: vi.fn(async () => ({ id: "cs_1", object: "checkout.session", status: "expired" })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(async () => RAW_SUBSCRIPTION),
      update: vi.fn(async () => ({ id: "sub_1", object: "subscription" })),
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({
          data: [{ id: "bpc_1", metadata: { bis_portal: "v1" } }, { id: "bpc_2", metadata: null }],
          has_more: overrides.portalHasMore ?? false,
        })),
        create: vi.fn(async () => ({ id: "bpc_new", object: "billing_portal.configuration", active: true })),
      },
      sessions: {
        create: vi.fn(async () => ({ id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/x" })),
      },
    },
    billing: {
      meters: {
        list: vi.fn(async () => ({
          data: [{ id: "mtr_sms", event_name: "bis_sms_segments" }], has_more: overrides.hasMore ?? false,
        })),
        create: vi.fn(async (p: { event_name: string }) => ({ id: "mtr_new", event_name: p.event_name })),
      },
      meterEvents: {
        create: vi.fn(async () => ({ object: "billing.meter_event", identifier: "u_1", livemode: false })),
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

/** Fake literal URLs only; nothing here connects. */
const PROD_URL = "https://tlbkbmlrfafquucsmsmm.supabase.co";
const CI_URL = "https://odnobiodsftffphuuosz.supabase.co";

describe("stripeKeyVerdict (a Stripe TEST key never writes plans into production's database)", () => {
  it("carries the same production ref as packages/db's constant (mutation: change one character of this file's PRODUCTION_SUPABASE_REF → FAILS)", () => {
    // apps/web cannot import packages/db/src/ci/target.ts (@bis/db exports
    // only "." and "./search-term", and that file imports `pg`), so the ref
    // is one constant per package and this keeps the two in step, the same
    // way e2e/fixtures/production-guard.test.ts does for its own copy.
    expect(PRODUCTION_SUPABASE_REF).toBe("tlbkbmlrfafquucsmsmm");
    const dbSource = readFileSync(path.resolve(__dirname, "../../../../../packages/db/src/ci/target.ts"), "utf-8");
    expect(dbSource).toContain(`export const PRODUCTION_SUPABASE_REF = "${PRODUCTION_SUPABASE_REF}";`);
  });

  it.each<[string, StripeEnv, ReturnType<typeof stripeKeyVerdict>]>([
    ["a test key locally, against production's database", { STRIPE_SECRET_KEY: "sk_test_a", NEXT_PUBLIC_SUPABASE_URL: PROD_URL }, { ok: false, reason: "test_key_on_production_data" }],
    ["a restricted test key on a preview that shares production's database", { STRIPE_SECRET_KEY: "rk_test_b", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD_URL }, { ok: false, reason: "test_key_on_production_data" }],
    ["a test key in production", { STRIPE_SECRET_KEY: "sk_test_c", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD_URL }, { ok: false, reason: "test_key_on_production_data" }],
  ])("%s is refused (mutation: drop the production-database check → FAILS)", (_label, env, expected) => {
    expect(stripeKeyVerdict(env)).toEqual(expected);
  });

  it(`production's ref counts anywhere in the hostname, not only as the whole host: a subdomain like db.${PRODUCTION_SUPABASE_REF}.supabase.co still names production (mutation: change the hostname check from .includes(ref) to .startsWith(ref) → FAILS; mutation: change it to an exact "\${ref}.supabase.co" suffix match → FAILS)`, () => {
    expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_test_k", NEXT_PUBLIC_SUPABASE_URL: `https://db.${PRODUCTION_SUPABASE_REF}.supabase.co` }))
      .toEqual({ ok: false, reason: "test_key_on_production_data" });
  });

  it.each<[string, StripeEnv]>([
    ["a test key against the CI project", { STRIPE_SECRET_KEY: "sk_test_d", NEXT_PUBLIC_SUPABASE_URL: CI_URL }],
    ["a test key on a preview with its own database", { STRIPE_SECRET_KEY: "sk_test_e", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: CI_URL }],
  ])("%s is allowed (mutation: refuse every test key whenever a URL is set → FAILS)", (_label, env) => {
    expect(stripeKeyVerdict(env)).toEqual({ ok: true, key: env.STRIPE_SECRET_KEY });
  });

  it("a known non-production URL wins over VERCEL_ENV=production: a test key against the CI project is allowed even when VERCEL_ENV says production (mutation: change the ?? fallback to || so a known 'false' still falls through to VERCEL_ENV → FAILS)", () => {
    // The `??` only falls back to VERCEL_ENV when the URL is unusable (null
    // verdict). A known, non-production URL is a definite "no" (`false`),
    // which `??` leaves alone — the database is the authority once it is
    // known, and a `VERCEL_ENV=production` label does not override it.
    expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_test_l", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: CI_URL }))
      .toEqual({ ok: true, key: "sk_test_l" });
  });

  it("a live key against production's database, in production, is allowed (mutation: refuse ANY key when the URL names production → FAILS)", () => {
    expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_live_f", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD_URL }))
      .toEqual({ ok: true, key: "sk_live_f" });
  });

  it("a live key against production's database on a preview keeps the live-key reason (mutation: check the database before the live-key rule and report it for live keys too → FAILS)", () => {
    expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_live_g", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD_URL }))
      .toEqual({ ok: false, reason: "live_key_outside_production" });
  });

  it("production's ref only counts in the HOST: a path or query that mentions it is another server (mutation: search the whole URL string instead of its hostname → FAILS)", () => {
    for (const url of [
      `https://evil.example/${PRODUCTION_SUPABASE_REF}`,
      `https://evil.example/?next=https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
      `https://user:${PRODUCTION_SUPABASE_REF}@evil.example`,
    ]) {
      expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_test_h", NEXT_PUBLIC_SUPABASE_URL: url }), url)
        .toEqual({ ok: true, key: "sk_test_h" });
    }
  });

  it("the host is read the way a client resolves it: upper case and percent-encoding still name production (mutation: take the host by splitting the raw string instead of new URL(...).hostname → FAILS)", () => {
    for (const url of [
      `https://${PRODUCTION_SUPABASE_REF.toUpperCase()}.SUPABASE.CO`,
      `https://%74${PRODUCTION_SUPABASE_REF.slice(1)}.supabase.co`,
    ]) {
      expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_test_i", NEXT_PUBLIC_SUPABASE_URL: url }), url)
        .toEqual({ ok: false, reason: "test_key_on_production_data" });
    }
  });

  it("no URL (or one no client could use) cannot name a database, so only Vercel production refuses a test key (mutation: drop the VERCEL_ENV=production fallback → FAILS)", () => {
    for (const url of [undefined, "", "   ", "not a url"]) {
      expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_test_j", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: url }), String(url))
        .toEqual({ ok: false, reason: "test_key_on_production_data" });
      expect(stripeKeyVerdict({ STRIPE_SECRET_KEY: "sk_test_j", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: url }), String(url))
        .toEqual({ ok: true, key: "sk_test_j" });
    }
  });
});

describe("billingGatewayFromEnv", () => {
  it("never constructs Stripe for a test key against production's database, through the function the app actually calls (mutation: drop the production-database check → FAILS)", () => {
    stripeCtorSpy.mockClear();
    const g = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_test_UNIT", NEXT_PUBLIC_SUPABASE_URL: PROD_URL });
    expect(g).toEqual({ ok: false, reason: "test_key_on_production_data" });
    expect(stripeCtorSpy).not.toHaveBeenCalled();
  });

  it("with no argument (how the server actions call it) it reads the database URL from process.env too (mutation: default env built from STRIPE_SECRET_KEY and VERCEL_ENV only → FAILS)", () => {
    stripeCtorSpy.mockClear();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_UNIT");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROD_URL);
    try {
      expect(billingGatewayFromEnv()).toEqual({ ok: false, reason: "test_key_on_production_data" });
      expect(stripeCtorSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a test key against the CI project still constructs Stripe (mutation: refuse every test key whenever a URL is set → FAILS)", () => {
    stripeCtorSpy.mockClear();
    const g = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_test_UNIT", NEXT_PUBLIC_SUPABASE_URL: CI_URL });
    expect(g.ok).toBe(true);
    expect(stripeCtorSpy).toHaveBeenCalledWith("sk_test_UNIT", expect.objectContaining({ apiVersion: STRIPE_API_VERSION }));
  });

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

const EVENT: MeterEventInput = {
  eventName: "bis_sms_segments", customerId: "cus_1", value: 2, identifier: "u_1", timestampSeconds: 1790344800,
};

describe("meterEventParams (the usage mapping)", () => {
  it("sends the meter's event name, the row id as identifier, SECONDS, and a payload of strings under the meters' exact keys (mutation: value as a number → FAILS; payload key 'customer' → FAILS)", () => {
    expect(meterEventParams(EVENT)).toEqual({
      event_name: "bis_sms_segments", identifier: "u_1", timestamp: 1790344800,
      payload: { stripe_customer_id: "cus_1", value: "2" },
    });
  });

  it("refuses a value that is not a positive whole number before it can reach Stripe (mutation: drop the value guard → FAILS)", () => {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      expect(() => meterEventParams({ ...EVENT, value })).toThrow(/value/);
    }
  });

  it("refuses a timestamp that is not whole seconds: a fraction, zero, or MILLISECONDS (mutation: drop the upper bound → a millisecond timestamp reaches Stripe, FAILS)", () => {
    expect(() => meterEventParams({ ...EVENT, timestampSeconds: 1790344800.5 })).toThrow(/timestampSeconds/);
    expect(() => meterEventParams({ ...EVENT, timestampSeconds: 0 })).toThrow(/timestampSeconds/);
    expect(() => meterEventParams({ ...EVENT, timestampSeconds: 1790344800000 })).toThrow(/timestampSeconds/);
  });

  it("refuses a customer id that is not a Stripe customer (mutation: drop the cus_ check → FAILS)", () => {
    expect(() => meterEventParams({ ...EVENT, customerId: "acct_1" })).toThrow(/customerId/);
  });
});

describe("stripeGateway.reportMeterEvent", () => {
  it("creates ONE meter event with the mapped params under the idempotency key, passing maxNetworkRetries: 0 and a 10 s timeout of its own (which does not fully suppress the SDK's own single automatic retry of a reset connection — see stripe-gateway.ts's comments), and returns nothing Stripe sent back (mutation: drop the options argument → FAILS; drop the per-request transport → the client's 2 retries × 20 s apply, one send can run about 61.5 s, FAILS)", async () => {
    const s = stubStripe();
    await expect(stripeGateway(s as unknown as Stripe).reportMeterEvent(EVENT, "bis-usage-u_1-cus_1")).resolves.toBeUndefined();
    expect(s.billing.meterEvents.create).toHaveBeenCalledTimes(1);
    expect(s.billing.meterEvents.create).toHaveBeenCalledWith(meterEventParams(EVENT), {
      idempotencyKey: "bis-usage-u_1-cus_1", maxNetworkRetries: 0, timeout: 10_000,
    });
    expect(METER_EVENT_TIMEOUT_MS).toBe(10_000);
  });
});

describe("meterEventFailureKind (does one row's failure stop the tick?)", () => {
  it("an invalid request or an idempotency mismatch is that row's problem; anything else stops the tick (mutation: 'row' for everything → FAILS; 'systemic' for everything → FAILS)", () => {
    const typed = (type: string) => Object.assign(new Error(type), { type });
    expect(meterEventFailureKind(typed("StripeInvalidRequestError"), "u_1")).toBe("row");
    expect(meterEventFailureKind(typed("StripeIdempotencyError"), "u_1")).toBe("row");
    for (const t of ["StripeRateLimitError", "StripeAuthenticationError", "StripePermissionError", "StripeConnectionError", "StripeAPIError"]) {
      expect(meterEventFailureKind(typed(t), "u_1")).toBe("systemic");
    }
    expect(meterEventFailureKind(new Error("socket hang up"), "u_1")).toBe("systemic");
    expect(meterEventFailureKind("not an error", "u_1")).toBe("systemic");
    expect(meterEventFailureKind(null, "u_1")).toBe("systemic");
  });

  it("an invalid request saying Stripe already holds the identifier SENT is a duplicate, not a refusal (mutation: no duplicate class → 'row', FAILS; ignore the identifier → the u_2 case is 'duplicate', FAILS)", () => {
    const already = (id: string) =>
      Object.assign(new Error(`An event already exists with identifier ${id}.`), { type: "StripeInvalidRequestError" });
    expect(meterEventFailureKind(already("u_1"), "u_1")).toBe("duplicate");
    expect(meterEventFailureKind(already("u_2"), "u_1")).toBe("row");
  });
});

describe("FakeGateway meter events (as Stripe does: replay is A10; a held identifier under a new key is REFUSED, A11 as observed)", () => {
  it("the same key with the same event replays: no second event (mutation: record on replay → FAILS)", async () => {
    const g = new FakeGateway();
    await g.reportMeterEvent(EVENT, "k1");
    await g.reportMeterEvent(EVENT, "k1");
    expect(g.meterEvents).toEqual([EVENT]);
    expect(g.calls.filter((c) => c.op === "reportMeterEvent")).toHaveLength(2);
  });

  it("the same identifier under a NEW key is refused with the invalid request real Stripe test mode returned (A11, observed by e2e/usage-meter.spec.ts), and records nothing (mutation: record a second event → two events, FAILS; throw a plain Error → the classifier reads 'systemic', FAILS)", async () => {
    const g = new FakeGateway();
    await g.reportMeterEvent(EVENT, "k1");
    const refusal = await g.reportMeterEvent(EVENT, "k2").then(() => null, (e: unknown) => e);
    expect(refusal).toMatchObject({ type: "StripeInvalidRequestError", message: "An event already exists with identifier u_1." });
    expect(meterEventFailureKind(refusal, "u_1")).toBe("duplicate");
    expect(g.meterEvents).toEqual([EVENT]);
  });

  it("the refusal is by identifier alone, whatever else the new key's event carries (a changed customer id is the other way BIS resends a row) (assumption, unobserved: Stripe holds identifiers per Stripe account, not per customer; mutation: key the dedupe on identifier + customer → a second event, FAILS)", async () => {
    const g = new FakeGateway();
    await g.reportMeterEvent(EVENT, "k1");
    await expect(g.reportMeterEvent({ ...EVENT, customerId: "cus_2" }, "k2")).rejects.toMatchObject({ type: "StripeInvalidRequestError" });
    expect(g.meterEvents).toEqual([EVENT]);
  });

  it("the same key with a different event throws, as Stripe's 400 does (mutation: replay without comparing → FAILS)", async () => {
    const g = new FakeGateway();
    await g.reportMeterEvent(EVENT, "k1");
    await expect(g.reportMeterEvent({ ...EVENT, value: 3 }, "k1")).rejects.toThrow(/idempotency/i);
  });

  it("runs the same guard as the real adapter, so a fractional value reaches nobody (mutation: skip meterEventParams in the fake → FAILS)", async () => {
    const g = new FakeGateway();
    await expect(g.reportMeterEvent({ ...EVENT, value: 1.5 }, "k1")).rejects.toThrow(/value/);
    expect(g.meterEvents).toEqual([]);
  });

  it("failOn throws the chosen error, which the usage report's tests use (mutation: ignore failOn.error → a generic Error, FAILS)", async () => {
    const g = new FakeGateway();
    const refused = Object.assign(new Error("No such customer"), { type: "StripeInvalidRequestError" });
    g.failOn = { op: "reportMeterEvent", error: refused };
    await expect(g.reportMeterEvent(EVENT, "k1")).rejects.toBe(refused);
  });
});

const PRICES = { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" };
const CHECKOUT = {
  accountId: "11111111-1111-4111-8111-111111111111", planId: "22222222-2222-4222-8222-222222222222",
  customerId: "cus_1", priceIds: PRICES,
  successUrl: "https://app.example/billing-done?result=success", cancelUrl: "https://app.example/billing-done?result=cancelled",
};

describe("checkoutSessionParams", () => {
  it("is a subscription with the plan's FOUR prices: the base once, the three metered ones with no quantity (Stripe measures them), and the account + plan in BOTH the session's and the subscription's metadata (mutation: drop a meter price → FAILS; give a metered line a quantity → FAILS; drop subscription_data.metadata → the webhook cannot find the account, FAILS)", () => {
    expect(checkoutSessionParams(CHECKOUT)).toEqual({
      mode: "subscription", customer: "cus_1", client_reference_id: CHECKOUT.accountId,
      line_items: [{ price: "price_b", quantity: 1 }, { price: "price_v" }, { price: "price_s" }, { price: "price_a" }],
      subscription_data: { metadata: { bis_account_id: CHECKOUT.accountId, bis_plan_id: CHECKOUT.planId } },
      metadata: { bis_account_id: CHECKOUT.accountId, bis_plan_id: CHECKOUT.planId },
      success_url: CHECKOUT.successUrl, cancel_url: CHECKOUT.cancelUrl,
    });
  });

  it("refuses a non-customer id and a non-price id before anything leaves the process (mutation: drop either guard → FAILS)", () => {
    expect(() => checkoutSessionParams({ ...CHECKOUT, customerId: "acct_1" })).toThrow(/customerId/);
    expect(() => checkoutSessionParams({ ...CHECKOUT, priceIds: { ...PRICES, sms: "prod_x" } })).toThrow(/sms/);
  });
});

describe("idempotencyKey", () => {
  it("changes when ANY parameter changes, nested or not, and not when key order does (every key covers every parameter) (mutation: hash only the top-level keys → the nested change keeps the key, FAILS; hash JSON.stringify unsorted → the reordered object changes the key, FAILS)", () => {
    const k = idempotencyKey("bis-checkout", "req_1", CHECKOUT);
    expect(idempotencyKey("bis-checkout", "req_1", { ...CHECKOUT, priceIds: { ...PRICES, sms: "price_s2" } })).not.toBe(k);
    expect(idempotencyKey("bis-checkout", "req_2", CHECKOUT)).not.toBe(k);
    const reordered = Object.fromEntries(Object.entries(CHECKOUT).reverse());
    expect(idempotencyKey("bis-checkout", "req_1", reordered)).toBe(k);
    expect(idempotencyKey("bis-checkout", "req_1", { ...CHECKOUT, priceIds: Object.fromEntries(Object.entries(PRICES).reverse()) })).toBe(k);
    expect(k).toMatch(/^bis-checkout-req_1-[0-9a-f]{24}$/);
  });

  it("refuses a value it cannot hash faithfully (a Date, Map or Set would each hash as {}, so two different requests would share one key) (mutation: drop the plain-object check → a Date hashes as {}, FAILS)", () => {
    expect(() => idempotencyKey("bis-x", "id_1", { at: new Date(0) })).toThrow(/plain/);
    expect(() => idempotencyKey("bis-x", "id_1", { m: new Map([["a", 1]]) })).toThrow(/plain/);
    expect(() => idempotencyKey("bis-x", "id_1", { s: new Set([1]) })).toThrow(/plain/);
    expect(idempotencyKey("bis-x", "id_1", { a: [1, { b: null }], c: Object.assign(Object.create(null), { d: "e" }) }))
      .toMatch(/^bis-x-id_1-[0-9a-f]{24}$/);
  });
});

/**
 * A subscription as `subscriptions.retrieve(id)` returns it WITHOUT `expand`:
 * `customer` is the id STRING (retrieveSubscription does not expand it). The
 * LATER item is listed first, so "the earliest period" cannot be satisfied by
 * reading items[0].
 */
const rawSubscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", customer: "cus_1", status: "past_due", start_date: 1_790_000_000,
  metadata: { bis_account_id: CHECKOUT.accountId, bis_plan_id: "stale-in-metadata" },
  items: {
    has_more: false,
    data: [
      { id: "si_s", current_period_start: 1_790_000_060, current_period_end: 1_792_592_060,
        price: { id: "price_s", metadata: { bis_plan_id: CHECKOUT.planId, bis_price: "sms" } } },
      { id: "si_b", current_period_start: 1_790_000_000, current_period_end: 1_792_592_000,
        price: { id: "price_b", metadata: { bis_plan_id: CHECKOUT.planId, bis_price: "base" } } },
    ],
  },
  ...over,
}) as unknown as Stripe.Subscription;
const RAW_SUBSCRIPTION = rawSubscription();
const SNAPSHOT: SubscriptionSnapshot = {
  id: "sub_1", customerId: "cus_1", status: "past_due", accountId: CHECKOUT.accountId, planId: CHECKOUT.planId,
  currentPeriodStart: 1_790_000_000, currentPeriodEnd: 1_792_592_000, startedAt: 1_790_000_000,
  items: [
    { id: "si_s", priceId: "price_s", priceKey: "sms", planId: CHECKOUT.planId },
    { id: "si_b", priceId: "price_b", priceKey: "base", planId: CHECKOUT.planId },
  ],
};

describe("subscriptionSnapshot", () => {
  it("reads the plan from the BASE PRICE's metadata (not the subscription's), the period from the items (the EARLIEST, listed second here), and the customer id as the unexpanded STRING retrieve returns (G6) (mutation: plan from subscription metadata → 'stale-in-metadata', FAILS; period from items[0] or the last item → FAILS; read customer.id only → undefined, FAILS)", () => {
    expect(subscriptionSnapshot(rawSubscription())).toEqual(SNAPSHOT);
  });

  it("an EXPANDED customer object gives the same customer id (mutation: read the customer only as a string → the object leaks through, FAILS)", () => {
    expect(subscriptionSnapshot(rawSubscription({ customer: { id: "cus_1", object: "customer" } })).customerId).toBe("cus_1");
  });

  it("refuses a subscription whose items do not fit one page rather than guess (B8) (mutation: ignore has_more → FAILS)", () => {
    expect(() => subscriptionSnapshot(rawSubscription({ items: { has_more: true, data: [] } }))).toThrow(/items/);
  });
});

describe("the new gateway surface", () => {
  it("portalConfigurationParams: card updates and invoice history ON; self-cancel, plan switching and profile edits OFF; tagged with the version BIS looks for (G19) (mutation: enable subscription_cancel → FAILS)", () => {
    expect(portalConfigurationParams()).toEqual({
      features: {
        invoice_history: { enabled: true }, payment_method_update: { enabled: true },
        customer_update: { enabled: false }, subscription_cancel: { enabled: false }, subscription_update: { enabled: false },
      },
      metadata: { bis_portal: PORTAL_VERSION },
    });
  });

  it("billingGatewayFromEnv says which MODE its key is, for the webhook's livemode check (mutation: always false → a live endpoint's every event is refused, FAILS)", () => {
    const test = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_SUPABASE_URL: "https://ci.supabase.co" });
    expect(test.ok).toBe(true);
    expect(test.ok && test.live).toBe(false);
    const live = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_live_x", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://tlbkbmlrfafquucsmsmm.supabase.co" });
    expect(live.ok && live.live).toBe(true);
  });

  it("FakeGateway.createCheckoutSession replays one key, refuses the same key with other params, and expire only works on an open session, as Stripe does (mutation: mint a new session on a replayed key → FAILS)", async () => {
    const fake = new FakeGateway();
    const a = await fake.createCheckoutSession(CHECKOUT, "k1");
    expect(await fake.createCheckoutSession(CHECKOUT, "k1")).toEqual(a);
    await expect(fake.createCheckoutSession({ ...CHECKOUT, customerId: "cus_2" }, "k1")).rejects.toThrow(/idempotency/);
    expect(await fake.getCheckoutSessionStatus(a.id)).toBe("open");
    await fake.expireCheckoutSession(a.id);
    expect(await fake.getCheckoutSessionStatus(a.id)).toBe("expired");
    await expect(fake.expireCheckoutSession(a.id)).rejects.toThrow(/open/);
  });

  it("FakeGateway.updateSubscriptionPrices is all-or-nothing, as a Stripe request is: a change naming a missing item (or subscription) throws, changes NOTHING, records nothing, and the same key retried throws again; a valid change applies whole (mutation: record the replay before validating → the retry resolves, FAILS; apply items one by one → si_s already swapped, FAILS)", async () => {
    const fake = new FakeGateway();
    fake.subscriptions.set("sub_1", structuredClone(SNAPSHOT));
    const broken = { subscriptionId: "sub_1", planId: "plan_new", items: [{ id: "si_s", price: "price_s2" }, { id: "si_missing", price: "price_b2" }] };
    await expect(fake.updateSubscriptionPrices(broken, "k1")).rejects.toThrow(/si_missing/);
    expect(fake.subscriptions.get("sub_1")).toEqual(SNAPSHOT);
    expect(fake.subscriptionChanges).toEqual([]);
    await expect(fake.updateSubscriptionPrices(broken, "k1")).rejects.toThrow(/si_missing/);

    const noSub = { subscriptionId: "sub_gone", planId: "plan_new", items: [{ id: "si_s", price: "price_s2" }] };
    await expect(fake.updateSubscriptionPrices(noSub, "k2")).rejects.toThrow(/sub_gone/);
    await expect(fake.updateSubscriptionPrices(noSub, "k2")).rejects.toThrow(/sub_gone/);
    expect(fake.subscriptionChanges).toEqual([]);

    const ok = { subscriptionId: "sub_1", planId: "plan_new", items: [{ id: "si_s", price: "price_s2" }, { id: "si_b", price: "price_b2" }] };
    await fake.updateSubscriptionPrices(ok, "k3");
    expect(fake.subscriptions.get("sub_1")).toEqual({
      ...SNAPSHOT, planId: "plan_new",
      items: [
        { id: "si_s", priceId: "price_s2", priceKey: "sms", planId: "plan_new" },
        { id: "si_b", priceId: "price_b2", priceKey: "base", planId: "plan_new" },
      ],
    });
    expect(fake.subscriptionChanges).toEqual([{ change: ok, key: "k3" }]);
  });
});

describe("stripeGateway: the PR-3 calls (exact params AND options, on a stub client)", () => {
  const gw = (o: StubOverrides = {}) => {
    const s = stubStripe(o);
    return { s, g: stripeGateway(s as unknown as Stripe) };
  };

  it("createCustomer sends the email, the account tag and the name under the idempotency key, omits a null name, and returns exactly { id } (mutation: drop the options argument → FAILS; send name: null → FAILS)", async () => {
    const { s, g } = gw();
    expect(await g.createCustomer({ accountId: CHECKOUT.accountId, name: "Rio Roofing", email: "owner@example.com" }, "k-cus"))
      .toEqual({ id: "cus_new" });
    expect(s.customers.create).toHaveBeenCalledWith(
      { email: "owner@example.com", metadata: { bis_account_id: CHECKOUT.accountId }, name: "Rio Roofing" }, { idempotencyKey: "k-cus" });
    await g.createCustomer({ accountId: CHECKOUT.accountId, name: null, email: "owner@example.com" }, "k-cus2");
    expect(s.customers.create).toHaveBeenLastCalledWith(
      { email: "owner@example.com", metadata: { bis_account_id: CHECKOUT.accountId } }, { idempotencyKey: "k-cus2" });
  });

  it("createCheckoutSession sends checkoutSessionParams under the idempotency key and returns Stripe's id, url and expires_at (mutation: drop { idempotencyKey } → a retried Send opens a SECOND payable session, FAILS)", async () => {
    const { s, g } = gw();
    expect(await g.createCheckoutSession(CHECKOUT, "k-cs"))
      .toEqual({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1", expiresAt: 1_790_086_400 });
    expect(s.checkout.sessions.create).toHaveBeenCalledWith(checkoutSessionParams(CHECKOUT), { idempotencyKey: "k-cs" });
  });

  it("createCheckoutSession refuses a session Stripe returned with no url rather than save a link nobody can open (mutation: drop the url check → resolves with url null, FAILS)", async () => {
    await expect(gw({ sessionUrl: null }).g.createCheckoutSession(CHECKOUT, "k-cs")).rejects.toThrow(/no url/);
  });

  it("getCheckoutSessionStatus retrieves the session by id and returns open, complete and expired as they are (mutation: always 'open' → FAILS)", async () => {
    for (const status of ["open", "complete", "expired"] as const) {
      const { s, g } = gw({ sessionStatus: status });
      expect(await g.getCheckoutSessionStatus("cs_1")).toBe(status);
      expect(s.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_1");
    }
  });

  it("getCheckoutSessionStatus throws on a status BIS does not know, and on null, instead of casting it (mutation: return status as CheckoutStatus → resolves 'draft', FAILS)", async () => {
    await expect(gw({ sessionStatus: "draft" }).g.getCheckoutSessionStatus("cs_1")).rejects.toThrow(/draft/);
    await expect(gw({ sessionStatus: null }).g.getCheckoutSessionStatus("cs_1")).rejects.toThrow(/null/);
  });

  it("expireCheckoutSession expires exactly that session, once, and returns nothing Stripe sent back (mutation: return the session → FAILS; expire another id → FAILS)", async () => {
    const { s, g } = gw();
    await expect(g.expireCheckoutSession("cs_1")).resolves.toBeUndefined();
    expect(s.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(s.checkout.sessions.expire).toHaveBeenCalledWith("cs_1");
  });

  it("retrieveSubscription reads the subscription by id, unexpanded, and returns its snapshot with the customer id string (mutation: return the raw subscription → FAILS; add an expand option → the call changes, FAILS)", async () => {
    const { s, g } = gw();
    expect(await g.retrieveSubscription("sub_1")).toEqual(SNAPSHOT);
    expect(s.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
  });

  it("updateSubscriptionPrices swaps each item's price in place with create_prorations and tags the plan, under the idempotency key (DECISION 2) (mutation: proration_behavior 'always_invoice' → FAILS; drop { idempotencyKey } → a double click changes the plan twice, FAILS)", async () => {
    const { s, g } = gw();
    const change = { subscriptionId: "sub_1", planId: "plan_new", items: [{ id: "si_b", price: "price_b2" }, { id: "si_s", price: "price_s2" }] };
    await expect(g.updateSubscriptionPrices(change, "k-chg")).resolves.toBeUndefined();
    expect(s.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_b", price: "price_b2" }, { id: "si_s", price: "price_s2" }],
      proration_behavior: "create_prorations",
      metadata: { bis_plan_id: "plan_new" },
    }, { idempotencyKey: "k-chg" });
  });

  it("listPortalConfigurations asks for ACTIVE ones, maps id and metadata (a null metadata to {}), and refuses to guess past one page (mutation: drop active → FAILS; ignore has_more → resolves, FAILS)", async () => {
    const { s, g } = gw();
    expect(await g.listPortalConfigurations()).toEqual([{ id: "bpc_1", metadata: { bis_portal: "v1" } }, { id: "bpc_2", metadata: {} }]);
    expect(s.billingPortal.configurations.list).toHaveBeenCalledWith({ active: true, limit: 100 });
    await expect(gw({ portalHasMore: true }).g.listPortalConfigurations()).rejects.toThrow(/more than 100/);
  });

  it("createPortalConfiguration sends portalConfigurationParams under the idempotency key and returns exactly { id } (mutation: drop the options argument → FAILS)", async () => {
    const { s, g } = gw();
    expect(await g.createPortalConfiguration("k-bpc")).toEqual({ id: "bpc_new" });
    expect(s.billingPortal.configurations.create).toHaveBeenCalledWith(portalConfigurationParams(), { idempotencyKey: "k-bpc" });
  });

  it("createPortalSession opens the portal for that customer with the return URL and BIS's OWN configuration (card + invoices, no self-cancel, DECISION 3), and returns exactly { url } (mutation: drop configuration → Stripe falls back to the account's default portal configuration, not BIS's, FAILS)", async () => {
    const { s, g } = gw();
    expect(await g.createPortalSession({ customerId: "cus_1", returnUrl: "https://app.example/a/billing", configurationId: "bpc_1" }))
      .toEqual({ url: "https://billing.stripe.com/p/session/x" });
    expect(s.billingPortal.sessions.create)
      .toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://app.example/a/billing", configuration: "bpc_1" });
  });
});
