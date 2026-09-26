import { createHash } from "node:crypto";
import Stripe from "stripe";
import {
  METER_KEYS, type MeterKey, type PlanPriceKey, type StripePriceIds,
  type SubscriptionItemSnapshot, type SubscriptionSnapshot,
} from "@bis/db";

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
   *  period of at least 24 hours". A SECOND key carrying it is REFUSED with
   *  "An event already exists with identifier <id>." (A11, observed in test
   *  mode); meterEventFailureKind calls that refusal "duplicate". */
  identifier: string;
  timestampSeconds: number;
};

/** A Checkout session for one account on one plan (spec flow 2). */
export type CheckoutInput = {
  accountId: string;
  planId: string;
  customerId: string;
  priceIds: StripePriceIds;
  successUrl: string;
  cancelUrl: string;
};
export type CheckoutSession = { id: string; url: string; expiresAt: number };
export type CheckoutStatus = "open" | "complete" | "expired";
/** Change plan (G15): each item's price swapped in place. */
export type SubscriptionPriceChange = { subscriptionId: string; planId: string; items: { id: string; price: string }[] };
export type PortalSessionInput = { customerId: string; returnUrl: string; configurationId: string };
/** The five Customer Portal features BIS sets, each ON or OFF. */
export const PORTAL_FEATURES = [
  "invoice_history", "payment_method_update", "customer_update", "subscription_cancel", "subscription_update",
] as const;
export type PortalFeature = (typeof PORTAL_FEATURES)[number];
/** `features` is what the configuration allows NOW, as Stripe reports it: a
 *  tagged configuration can be edited in the Stripe dashboard after BIS made
 *  it, and ensurePortalConfiguration (portal.ts) refuses one that drifted. */
export type PortalConfiguration = { id: string; metadata: Record<string, string>; features: Record<PortalFeature, boolean> };

export interface BillingGateway {
  listActiveMeters(): Promise<StripeMeter[]>;
  createMeter(input: { eventName: string; displayName: string }, idempotencyKey: string): Promise<StripeMeter>;
  createProduct(input: { planId: string; name: string }, idempotencyKey: string): Promise<{ id: string }>;
  renameProduct(productId: string, name: string): Promise<void>;
  createPrice(spec: PriceSpec, idempotencyKey: string): Promise<{ id: string }>;
  reportMeterEvent(input: MeterEventInput, idempotencyKey: string): Promise<void>;
  createCustomer(input: { accountId: string; name: string | null; email: string }, idempotencyKey: string): Promise<{ id: string }>;
  updateCustomerEmail(customerId: string, email: string, idempotencyKey: string): Promise<void>;
  createCheckoutSession(input: CheckoutInput, idempotencyKey: string): Promise<CheckoutSession>;
  getCheckoutSessionStatus(sessionId: string): Promise<CheckoutStatus>;
  expireCheckoutSession(sessionId: string): Promise<void>;
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>;
  updateSubscriptionPrices(change: SubscriptionPriceChange, idempotencyKey: string): Promise<void>;
  listPortalConfigurations(): Promise<PortalConfiguration[]>;
  createPortalConfiguration(idempotencyKey: string): Promise<{ id: string }>;
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
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
 * Stripe's refusal of an identifier it already holds (A11, observed in test
 * mode by e2e/usage-meter.spec.ts: the same identifier under a NEW
 * idempotency key). Matched on the MESSAGE, because the observation recorded
 * no error code for it and the installed SDK's types name none for meter
 * events (assumption: the wording is stable; if Stripe rewords it, the
 * refusal falls back to "row", the pre-fix behaviour, noisy but never wrong).
 * The capture is the identifier Stripe names, compared whole against the one
 * sent, so a refusal about any other event can never be taken for ours.
 */
const ALREADY_EXISTS = /^an event already exists with identifier (.+?)\.?$/i;

/**
 * What one meter event's failure means for the report this tick. Read from
 * the SDK error's `.type` (each class sets it to its own name), not from
 * `instanceof`, so a test double and the real SDK classify alike.
 *
 *   duplicate  Stripe already holds an event with the identifier SENT: the
 *              usage is at Stripe, so the row is stamped, not retried
 *   row        this request's problem; the account waits for the next tick
 *   systemic   anything else; the next row would fail the same way
 */
export function meterEventFailureKind(e: unknown, sentIdentifier: string): "duplicate" | "row" | "systemic" {
  const err = typeof e === "object" && e !== null ? (e as { type?: unknown; message?: unknown }) : {};
  if (typeof err.type !== "string" || !ROW_SPECIFIC_ERRORS.has(err.type)) return "systemic";
  if (err.type === "StripeInvalidRequestError" && typeof err.message === "string") {
    const named = ALREADY_EXISTS.exec(err.message.trim())?.[1];
    if (named !== undefined && named === sentIdentifier) return "duplicate";
  }
  return "row";
}

/** JSON with every object's keys sorted, recursively: equal params → equal
 *  text, whatever order they were built in. Only arrays and PLAIN objects
 *  are walked; any other object (a Date, Map, Set, class instance) has no
 *  own enumerable keys worth hashing and would read as `{}`, so two different
 *  requests could share a key. It throws instead. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`idempotencyKey: params must be plain objects and arrays, got a ${String(proto?.constructor?.name ?? "non-plain object")}`);
    }
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/**
 * An idempotency key that covers EVERY parameter the request sends (PR-1's
 * correction): `<prefix>-<id>-<24 hex of sha256(canonical params)>`. The same
 * request retried replays; any changed parameter is a new request, never a
 * 400 from Stripe for reusing a key with different parameters. Under
 * Stripe's 255-character limit for any id under 200 characters.
 */
export function idempotencyKey(prefix: string, id: string, params: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(canonical(params))).digest("hex").slice(0, 24);
  return `${prefix}-${id}-${hash}`;
}

const PRICE_KEYS: readonly PlanPriceKey[] = ["base", ...METER_KEYS];

/**
 * The Checkout mapping (spec flow 2): subscription mode, the plan's base
 * price once and its three metered prices WITHOUT a quantity (Stripe
 * measures them; assumption B1, unverified here, proven only by the e2e),
 * the account and plan in the session's metadata AND the subscription's (the
 * webhook reads the subscription's), and client_reference_id for the
 * dashboard. Guarded like priceCreateParams: a wrong id never leaves the
 * process.
 */
export function checkoutSessionParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  if (!input.customerId.startsWith("cus_")) {
    throw new Error(`checkoutSessionParams: customerId must be a Stripe customer id (cus_), got ${input.customerId}`);
  }
  for (const key of PRICE_KEYS) {
    if (!input.priceIds[key]?.startsWith("price_")) {
      throw new Error(`checkoutSessionParams: ${key} must be a Stripe price id (price_), got ${input.priceIds[key]}`);
    }
  }
  const metadata = { bis_account_id: input.accountId, bis_plan_id: input.planId };
  return {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.accountId,
    line_items: [
      { price: input.priceIds.base, quantity: 1 },
      { price: input.priceIds.voice_minutes },
      { price: input.priceIds.sms },
      { price: input.priceIds.ai_chats },
    ],
    subscription_data: { metadata },
    metadata,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}

/**
 * What BIS keeps of a subscription (G6). The plan is the BASE item's price
 * metadata (every BIS price carries bis_plan_id and bis_price), never the
 * subscription's own metadata, which a Change plan could leave stale and a
 * dashboard edit could forge. The period lives on the ITEMS in this API
 * version; the earliest across items is the period. One page of items only
 * (assumption B8, unverified: all four fit); more is refused, not guessed.
 */
export function subscriptionSnapshot(sub: Stripe.Subscription): SubscriptionSnapshot {
  if (sub.items.has_more) throw new Error(`subscriptionSnapshot: ${sub.id} has more items than one page; refusing to guess`);
  const items: SubscriptionItemSnapshot[] = sub.items.data.map((it) => {
    const key = it.price.metadata?.bis_price ?? "";
    return {
      id: it.id,
      priceId: it.price.id,
      priceKey: (PRICE_KEYS as readonly string[]).includes(key) ? (key as PlanPriceKey) : null,
      planId: it.price.metadata?.bis_plan_id ?? null,
    };
  });
  const starts = sub.items.data.map((it) => it.current_period_start);
  const ends = sub.items.data.map((it) => it.current_period_end);
  return {
    id: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    status: sub.status,
    accountId: sub.metadata?.bis_account_id ?? null,
    planId: items.find((i) => i.priceKey === "base")?.planId ?? null,
    currentPeriodStart: starts.length > 0 ? Math.min(...starts) : null,
    currentPeriodEnd: ends.length > 0 ? Math.min(...ends) : null,
    startedAt: sub.start_date,
    items,
  };
}

/** The portal configuration BIS creates and later finds by this tag (G19). */
export const PORTAL_VERSION = "v1";

/** Update a card and see invoices. No self-cancel, no plan switching, no
 *  profile edits: the agency manages plans (decided, danlo 2026-09-25).
 *  That Stripe accepts a configuration built from only these features +
 *  metadata is assumption B3, unverified here; the e2e's portal click
 *  settles it. */
export function portalConfigurationParams(): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: false },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { bis_portal: PORTAL_VERSION },
  };
}

/** The ON/OFF of each feature in portalConfigurationParams(): what a
 *  configuration BIS may use must allow, exactly. Read from the params, so
 *  there is one statement of DECISION 3, not two. */
export function portalFeatureFlags(): Record<PortalFeature, boolean> {
  const { features } = portalConfigurationParams();
  return Object.fromEntries(PORTAL_FEATURES.map((f) => [f, features[f]?.enabled === true])) as Record<PortalFeature, boolean>;
}

/** The six events the endpoint subscribes to (spec flow 4; Task 13 Step 5). */
export const HANDLED_WEBHOOK_EVENTS = [
  "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
  "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed",
] as const;

/** A verified event, reduced to what BIS acts on: which subscription to
 *  re-read. Nothing else from the payload is ever used (G5). */
export type VerifiedWebhookEvent = { id: string; type: string; livemode: boolean; subscriptionId: string | null };

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

function subscriptionIdOf(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      return session.mode === "subscription" ? idOf(session.subscription) : null;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return event.data.object.id;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      // `parent.subscription_details` in this API version; the top-level
      // `subscription` is what an endpoint on an older version sends
      // (assumption B7, unverified: the live endpoint is pinned to this
      // version, and this fallback covers one that is not).
      return idOf(invoice.parent?.subscription_details?.subscription)
        ?? idOf((invoice as unknown as { subscription?: string | { id: string } | null }).subscription);
    }
    default:
      return null;
  }
}

/**
 * Verifies `stripe-signature` over the RAW body (the exact string Stripe
 * signed; never a re-serialised parse) with Stripe's static helper, and
 * reduces the event. Throws a StripeSignatureVerificationError on a bad or
 * stale signature (tolerance: the SDK's 300 s default).
 */
export function verifyWebhookEvent(payload: string, signature: string, secret: string): VerifiedWebhookEvent {
  const event = Stripe.webhooks.constructEvent(payload, signature, secret);
  return { id: event.id, type: event.type, livemode: event.livemode, subscriptionId: subscriptionIdOf(event) };
}

export function isSignatureError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { type?: unknown }).type === "StripeSignatureVerificationError";
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
    async createCustomer({ accountId, name, email }, idempotencyKey) {
      const c = await stripe.customers.create(
        { email, metadata: { bis_account_id: accountId }, ...(name ? { name } : {}) },
        { idempotencyKey },
      );
      return { id: c.id };
    },
    async updateCustomerEmail(customerId, email, idempotencyKey) {
      // The address Stripe's receipts and payment emails go to (billing-link.ts).
      await stripe.customers.update(customerId, { email }, { idempotencyKey });
    },
    async createCheckoutSession(input, idempotencyKey) {
      const s = await stripe.checkout.sessions.create(checkoutSessionParams(input), { idempotencyKey });
      if (!s.url) throw new Error(`createCheckoutSession: Stripe returned session ${s.id} with no url`);
      return { id: s.id, url: s.url, expiresAt: s.expires_at };
    },
    async getCheckoutSessionStatus(sessionId) {
      const s = await stripe.checkout.sessions.retrieve(sessionId);
      // Widened first: Stripe's type ends in `| OtherString`, which an
      // equality check does not narrow away (TS2322 without this line).
      const status: string | null = s.status;
      if (status === "open" || status === "complete" || status === "expired") return status;
      throw new Error(`getCheckoutSessionStatus: ${sessionId} has status ${String(status)}`);
    },
    async expireCheckoutSession(sessionId) {
      await stripe.checkout.sessions.expire(sessionId);
    },
    async retrieveSubscription(subscriptionId) {
      return subscriptionSnapshot(await stripe.subscriptions.retrieve(subscriptionId));
    },
    async updateSubscriptionPrices(change, idempotencyKey) {
      // Change plan NOW, with proration (DECISION 2, danlo 2026-09-25).
      // Assumption B4, UNVERIFIED: swapping each item's price in place
      // mid-period prorates the base price, and prices the WHOLE period's
      // meter usage at the NEW metered prices at period end (a meter
      // aggregates per customer per meter, not per price). Nothing here or in
      // the e2e settles it; a Stripe test clock must, before the first live
      // mid-month Change plan.
      await stripe.subscriptions.update(change.subscriptionId, {
        items: change.items.map((i) => ({ id: i.id, price: i.price })),
        proration_behavior: "create_prorations",
        metadata: { bis_plan_id: change.planId },
      }, { idempotencyKey });
    },
    async listPortalConfigurations() {
      const page = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
      if (page.has_more) throw new Error("listPortalConfigurations: more than 100 active configurations; refusing to guess");
      return page.data.map((c) => ({
        id: c.id,
        metadata: c.metadata ?? {},
        features: Object.fromEntries(PORTAL_FEATURES.map((f) => [f, c.features[f].enabled])) as Record<PortalFeature, boolean>,
      }));
    },
    async createPortalConfiguration(idempotencyKey) {
      const c = await stripe.billingPortal.configurations.create(portalConfigurationParams(), { idempotencyKey });
      return { id: c.id };
    },
    async createPortalSession({ customerId, returnUrl, configurationId }) {
      const s = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, configuration: configurationId });
      return { url: s.url };
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
): { ok: true; gateway: BillingGateway; live: boolean } | Extract<StripeKeyVerdict, { ok: false }> {
  const verdict = stripeKeyVerdict(env);
  if (!verdict.ok) return verdict;
  const stripe = new Stripe(verdict.key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20_000 });
  // The key's MODE, for the webhook's livemode check (G4 step 4).
  const live = verdict.key.startsWith("sk_live_") || verdict.key.startsWith("rk_live_");
  return { ok: true, gateway: stripeGateway(stripe), live };
}
