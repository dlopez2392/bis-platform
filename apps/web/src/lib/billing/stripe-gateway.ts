import Stripe from "stripe";
import type { MeterKey } from "@bis/db";

/**
 * Everything BIS asks of Stripe (the Plans page, and the cron's usage
 * report), behind one interface:
 * `stripeGateway()` in production code, `FakeGateway` (./fake-gateway.ts)
 * in unit tests. Nothing else in the app imports the `stripe` SDK.
 */

/** The API version stripe@22.6.2 is typed against. Pinned so a dashboard
 *  upgrade of the account's default version cannot change what these calls
 *  mean under us. Upgrade it together with the package, never alone. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

export type StripeMeter = { id: string; eventName: string };

export type BasePriceSpec = { kind: "base"; planId: string; productId: string; unitAmountCents: number };
export type MeteredPriceSpec = {
  kind: "metered"; planId: string; productId: string; meter: MeterKey; meterId: string;
  allowance: number; overageCents: number;
};
export type PriceSpec = BasePriceSpec | MeteredPriceSpec;

/** One usage row as a Stripe meter event (client billing, usage report). */
export type MeterEventInput = {
  eventName: string;
  customerId: string;
  /** Whole units. Sent as a string (Stripe's payload values are strings). */
  value: number;
  /** The usage row's id. Stripe documents uniqueness "within a rolling
   *  period of at least 24 hours"; whether a SECOND key carrying it is
   *  deduplicated is assumption A11, unproven until the e2e observes it. */
  identifier: string;
  timestampSeconds: number;
};

export interface BillingGateway {
  listActiveMeters(): Promise<StripeMeter[]>;
  createMeter(input: { eventName: string; displayName: string }, idempotencyKey: string): Promise<StripeMeter>;
  createProduct(input: { planId: string; name: string }, idempotencyKey: string): Promise<{ id: string }>;
  renameProduct(productId: string, name: string): Promise<void>;
  createPrice(spec: PriceSpec, idempotencyKey: string): Promise<{ id: string }>;
  reportMeterEvent(input: MeterEventInput, idempotencyKey: string): Promise<void>;
}

const isNonNegativeInteger = (n: number): boolean => Number.isInteger(n) && n >= 0;

/**
 * Money values reach this function as cents; a float or a negative number
 * is a bug upstream, and Stripe's own validation (a DB CHECK too) runs
 * AFTER this call, not before it. Guard here so a bad value never leaves
 * the process — real Stripe and FakeGateway both route through this.
 */
function assertMoneyShape(spec: PriceSpec): void {
  if (spec.kind === "base") {
    if (!Number.isInteger(spec.unitAmountCents) || spec.unitAmountCents <= 0) {
      throw new Error(
        `priceCreateParams: unitAmountCents must be a positive integer number of cents, got ${spec.unitAmountCents}`,
      );
    }
    return;
  }
  if (!isNonNegativeInteger(spec.allowance)) {
    throw new Error(`priceCreateParams: allowance must be a non-negative integer, got ${spec.allowance}`);
  }
  if (!isNonNegativeInteger(spec.overageCents)) {
    throw new Error(`priceCreateParams: overageCents must be a non-negative integer number of cents, got ${spec.overageCents}`);
  }
}

/**
 * The money mapping. Base: a licensed monthly price. Metered: a monthly
 * price on the meter, GRADUATED so units up to the allowance cost 0 and every
 * unit after costs the overage (spec section 3.1). A zero allowance is a
 * plain per-unit price, because a tier cannot end at 0 (assumption A1).
 */
export function priceCreateParams(spec: PriceSpec): Stripe.PriceCreateParams {
  assertMoneyShape(spec);
  if (spec.kind === "base") {
    return {
      product: spec.productId, currency: "usd", unit_amount: spec.unitAmountCents,
      recurring: { interval: "month", usage_type: "licensed" },
      metadata: { bis_plan_id: spec.planId, bis_price: "base" },
    };
  }
  const recurring: Stripe.PriceCreateParams.Recurring = { interval: "month", usage_type: "metered", meter: spec.meterId };
  const metadata = { bis_plan_id: spec.planId, bis_price: spec.meter };
  if (spec.allowance === 0) {
    return { product: spec.productId, currency: "usd", unit_amount: spec.overageCents, recurring, metadata };
  }
  return {
    product: spec.productId, currency: "usd", billing_scheme: "tiered", tiers_mode: "graduated",
    tiers: [{ up_to: spec.allowance, unit_amount: 0 }, { up_to: "inf", unit_amount: spec.overageCents }],
    recurring, metadata,
  };
}

/** At or above this, a "seconds" timestamp is really milliseconds (in
 *  seconds it would be the year 5138). */
const MAX_TIMESTAMP_SECONDS = 100_000_000_000;

/**
 * One meter event's PER-REQUEST timeout, overriding the client's 2 retries ×
 * 20 s (billingGatewayFromEnv below), which could hold one send about 61.5 s.
 *
 * Assumption about the installed stripe SDK's transport (22.6.2; not
 * verified against the network, only its source), corrected from an earlier,
 * false claim of "no retry" and "a send that times out ends inside the
 * budget": `timeout` here is a SOCKET-IDLE timeout (`req.setTimeout`,
 * `cjs/net/NodeHttpClient.js:47`), not a hard deadline, so a response that
 * trickles in is never cut off by it; and `RequestSender.js`'s
 * `_shouldRetry` retries an `ECONNRESET`/`EPIPE` ONCE even when
 * `maxNetworkRetries: 0` is set (probed with a fake `httpClient`:
 * `ECONNRESET attempts=2 keys=["k1","k1"]` under the same idempotency key, so
 * it cannot double-bill). Worst case for one send that starts near a
 * budget's last-start point: ~10 s idle + reset + ~0.5 s backoff + ~10 s idle
 * ≈ 20.5 s past its start. The usage report's own budget (usage-report.ts)
 * is sized against that worst case, not against this constant alone.
 */
export const METER_EVENT_TIMEOUT_MS = 10_000;

/**
 * The usage mapping: one usage row → one v1 meter event. The payload keys
 * are the ones the meters were created with (customer_mapping
 * `stripe_customer_id`, value_settings `value`, createMeter below) and are
 * PERMANENT; the values are strings. Guarded here, like priceCreateParams,
 * so a fraction, a millisecond timestamp or a non-customer id never leaves
 * the process; real Stripe and FakeGateway both run this.
 */
export function meterEventParams(input: MeterEventInput): Stripe.Billing.MeterEventCreateParams {
  if (!Number.isSafeInteger(input.value) || input.value <= 0) {
    throw new Error(`meterEventParams: value must be a positive whole number, got ${input.value}`);
  }
  if (!Number.isSafeInteger(input.timestampSeconds) || input.timestampSeconds <= 0
    || input.timestampSeconds >= MAX_TIMESTAMP_SECONDS) {
    throw new Error(`meterEventParams: timestampSeconds must be whole seconds since the epoch, got ${input.timestampSeconds}`);
  }
  if (!input.customerId.startsWith("cus_")) {
    throw new Error(`meterEventParams: customerId must be a Stripe customer id (cus_), got ${input.customerId}`);
  }
  return {
    event_name: input.eventName, identifier: input.identifier, timestamp: input.timestampSeconds,
    payload: { stripe_customer_id: input.customerId, value: String(input.value) },
  };
}

/** Errors about THIS request; anything else (auth, permission, rate limit,
 *  network, Stripe 5xx) would fail the next row too (assumption A13). */
const ROW_SPECIFIC_ERRORS = new Set(["StripeInvalidRequestError", "StripeIdempotencyError"]);

/**
 * Does one meter event's failure stop the report for this tick? Read from
 * the SDK error's `.type` (each class sets it to its own name), not from
 * `instanceof`, so a test double and the real SDK classify alike.
 */
export function meterEventFailureKind(e: unknown): "row" | "systemic" {
  const type = typeof e === "object" && e !== null ? (e as { type?: unknown }).type : undefined;
  return typeof type === "string" && ROW_SPECIFIC_ERRORS.has(type) ? "row" : "systemic";
}

export function stripeGateway(stripe: Stripe): BillingGateway {
  return {
    async listActiveMeters() {
      const page = await stripe.billing.meters.list({ status: "active", limit: 100 });
      if (page.has_more) throw new Error("listActiveMeters: more than 100 active meters; refusing to guess which are ours");
      return page.data.map((m) => ({ id: m.id, eventName: m.event_name }));
    },
    async createMeter({ eventName, displayName }, idempotencyKey) {
      const m = await stripe.billing.meters.create({
        display_name: displayName, event_name: eventName,
        default_aggregation: { formula: "sum" },
        customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
        value_settings: { event_payload_key: "value" },
      }, { idempotencyKey });
      return { id: m.id, eventName: m.event_name };
    },
    async createProduct({ planId, name }, idempotencyKey) {
      const p = await stripe.products.create({ name, metadata: { bis_plan_id: planId } }, { idempotencyKey });
      return { id: p.id };
    },
    async renameProduct(productId, name) {
      await stripe.products.update(productId, { name });
    },
    async createPrice(spec, idempotencyKey) {
      const p = await stripe.prices.create(priceCreateParams(spec), { idempotencyKey });
      return { id: p.id };
    },
    async reportMeterEvent(input, idempotencyKey) {
      // Per-request transport (stripe 22.6.2 RequestOptions), overriding the
      // client-wide settings that suit the Plans page, not a cron pass with
      // a budget. `maxNetworkRetries: 0` does not stop the SDK's own single
      // automatic retry of a reset/broken-pipe connection, and `timeout` is
      // a socket-idle timeout, not a hard deadline — see the worst-case note
      // on METER_EVENT_TIMEOUT_MS above.
      await stripe.billing.meterEvents.create(meterEventParams(input), {
        idempotencyKey, maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS,
      });
    },
  };
}

export type StripeKeyVerdict =
  | { ok: true; key: string }
  | {
    ok: false;
    reason: "missing" | "live_key_outside_production" | "not_a_secret_key" | "test_key_on_production_data";
  };

/** What the verdict reads. `NEXT_PUBLIC_SUPABASE_URL` is the database
 *  `serviceDb()` writes plans to. */
export type StripeEnv = { STRIPE_SECRET_KEY?: string; VERCEL_ENV?: string; NEXT_PUBLIC_SUPABASE_URL?: string };

/**
 * Production's Supabase project ref. apps/web cannot import
 * packages/db/src/ci/target.ts (@bis/db exports only "." and
 * "./search-term", and that file imports `pg`), so this is apps/web's app-side
 * copy; stripe-gateway.test.ts fails if it stops matching that one.
 */
export const PRODUCTION_SUPABASE_REF = "tlbkbmlrfafquucsmsmm";

/**
 * Does this URL's HOST name production's project? Read with `new URL`, the
 * way a client resolves it (lower-cased, percent-decoded), and only the
 * hostname: production's ref in a path, query or userinfo is some other
 * server. Anywhere in the hostname, not only as the first label, because a
 * false "yes" costs a refused test key and a false "no" costs a test-mode plan
 * in production's table. `null` when there is no usable URL: no client can
 * reach any database with one, so it names none.
 */
function namesProductionDatabase(url: string | undefined): boolean | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.includes(PRODUCTION_SUPABASE_REF);
  } catch {
    return null;
  }
}

/**
 * A key's MODE has to match the DATABASE the plan is written to.
 *
 * A live key runs ONLY where VERCEL_ENV=production. Previews, local runs
 * and CI get test mode or nothing, the app-side twin of the CI guard's
 * check 6. A key that is not a secret key at all is named, not guessed at.
 *
 * A TEST key is refused wherever the app talks to production's database: a
 * plan saved there would be a row whose product and prices exist only in
 * Stripe test mode, shown as Active under a real plan's name, and every
 * live-mode edit of it would fail forever. That is `pnpm dev` on a machine
 * whose apps/web/.env.local still names production, and any preview that
 * shares production's database. With no usable URL the database is unknown;
 * then only VERCEL_ENV=production refuses a test key, because production
 * always means production's data, and anywhere else nothing can be written
 * without a URL anyway (`serviceDb()` throws first).
 */
export function stripeKeyVerdict(env: StripeEnv): StripeKeyVerdict {
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return { ok: false, reason: "missing" };
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  const test = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!live && !test) return { ok: false, reason: "not_a_secret_key" };
  if (live && env.VERCEL_ENV !== "production") return { ok: false, reason: "live_key_outside_production" };
  if (test && (namesProductionDatabase(env.NEXT_PUBLIC_SUPABASE_URL) ?? env.VERCEL_ENV === "production")) {
    return { ok: false, reason: "test_key_on_production_data" };
  }
  return { ok: true, key };
}

export function billingGatewayFromEnv(
  // `process.env` (NodeJS.ProcessEnv) satisfies this shape structurally at
  // runtime, but its properties come from an index signature, which TS's
  // "weak type" check (both sides all-optional, zero named properties in
  // common) does not count — hence the explicit cast rather than a bare
  // default (TS2559 under this repo's strict: true).
  env: StripeEnv = process.env as StripeEnv,
): { ok: true; gateway: BillingGateway } | Extract<StripeKeyVerdict, { ok: false }> {
  const verdict = stripeKeyVerdict(env);
  if (!verdict.ok) return verdict;
  const stripe = new Stripe(verdict.key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20_000 });
  return { ok: true, gateway: stripeGateway(stripe) };
}
