import type { SubscriptionSnapshot } from "@bis/db";
import {
  priceCreateParams, meterEventParams, checkoutSessionParams, PORTAL_VERSION,
  type BillingGateway, type MeterEventInput, type PriceSpec, type StripeMeter,
  type CheckoutInput, type CheckoutSession, type CheckoutStatus, type SubscriptionPriceChange,
  type PortalSessionInput, type PortalConfiguration,
} from "./stripe-gateway";

export type GatewayOp =
  | "listActiveMeters" | "createMeter" | "createProduct" | "renameProduct" | "createPrice" | "reportMeterEvent"
  | "createCustomer" | "createCheckoutSession" | "getCheckoutSessionStatus" | "expireCheckoutSession"
  | "retrieveSubscription" | "updateSubscriptionPrices" | "listPortalConfigurations" | "createPortalConfiguration"
  | "createPortalSession";

/** Structural equality good enough for the plain JSON-shaped op inputs this
 *  fake ever stores: PriceSpec, the {planId,name}/{eventName,displayName}
 *  shapes, CheckoutInput and SubscriptionPriceChange (an array compares
 *  index by index, its length through its key count). Not a general
 *  deep-equal utility; do not reuse elsewhere. */
function sameInput(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => sameInput((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * In-memory Stripe for unit tests. It mirrors the Stripe behaviour the
 * catalog depends on (assumption A4): a create sent with an idempotency key
 * seen before, for the SAME op and the SAME input, returns the FIRST result
 * and creates nothing new. The SAME key sent with a DIFFERENT op or input
 * throws, mirroring Stripe's own 400 on an idempotency-key mismatch — a
 * fake that silently replayed here would be looser than what it fakes, and
 * every later task's tests run only against this fake.
 *
 *   calls    every call, replays included, in order
 *   created  only calls that made something new (id minted)
 *   failOn   throw on the (after + 1)th call of `op`, and every one after;
 *            `error` when given (a Stripe-shaped error), else a plain Error
 *   meterEvents  the meter events Stripe would hold: one per identifier; a
 *            new key carrying a held identifier is refused, FOREVER (A11:
 *            observed only for the same customer, a fresh key, within
 *            seconds; see reportMeterEvent for where the fake departs)
 */
export class FakeGateway implements BillingGateway {
  meters: StripeMeter[] = [];
  readonly calls: Array<{ op: GatewayOp; key?: string; input?: unknown }> = [];
  readonly created: Array<{ op: GatewayOp; input: unknown; id: string }> = [];
  readonly meterEvents: MeterEventInput[] = [];
  failOn: { op: GatewayOp; after?: number; error?: unknown } | null = null;
  private seq = 0;
  private readonly replay = new Map<string, { op: GatewayOp; input: unknown; value: unknown }>();
  private readonly counts = new Map<GatewayOp, number>();

  private step(op: GatewayOp, input?: unknown, key?: string): void {
    this.calls.push({ op, key, input });
    const n = (this.counts.get(op) ?? 0) + 1;
    this.counts.set(op, n);
    if (this.failOn && this.failOn.op === op && n > (this.failOn.after ?? 0)) {
      throw this.failOn.error ?? new Error(`fake Stripe refused ${op}`);
    }
  }

  private once<T extends { id: string }>(op: GatewayOp, key: string, input: unknown, make: (id: string) => T): T {
    const seen = this.replay.get(key);
    if (seen) {
      if (seen.op !== op || !sameInput(seen.input, input)) {
        throw new Error(
          `fake Stripe: idempotency key "${key}" was already used for ${seen.op} with different parameters; ` +
            `Stripe itself rejects this with a 400 (assumption A4)`,
        );
      }
      return seen.value as T;
    }
    const PREFIX: Partial<Record<GatewayOp, string>> = {
      createMeter: "mtr", createProduct: "prod", createPrice: "price", createCustomer: "cus",
      createCheckoutSession: "cs_test", createPortalConfiguration: "bpc",
    };
    const value = make(`${PREFIX[op] ?? "obj"}_${++this.seq}`);
    this.replay.set(key, { op, input, value });
    this.created.push({ op, input, id: value.id });
    return value;
  }

  async listActiveMeters(): Promise<StripeMeter[]> {
    this.step("listActiveMeters");
    return [...this.meters];
  }

  async createMeter(input: { eventName: string; displayName: string }, key: string): Promise<StripeMeter> {
    this.step("createMeter", input, key);
    return this.once("createMeter", key, input, (id) => {
      const m = { id, eventName: input.eventName };
      this.meters.push(m);
      return m;
    });
  }

  async createProduct(input: { planId: string; name: string }, key: string): Promise<{ id: string }> {
    this.step("createProduct", input, key);
    return this.once("createProduct", key, input, (id) => ({ id }));
  }

  async renameProduct(productId: string, name: string): Promise<void> {
    this.step("renameProduct", { productId, name });
  }

  async createPrice(spec: PriceSpec, key: string): Promise<{ id: string }> {
    // Same money guard the real gateway runs (drives the mapping only for
    // its validation side effect; the mapped params themselves are never
    // sent anywhere from here) — a bad value must fail the same way against
    // both the fake and the real Stripe adapter.
    priceCreateParams(spec);
    this.step("createPrice", spec, key);
    return this.once("createPrice", key, spec, (id) => ({ id }));
  }

  /**
   * A meter event. Same idempotency strictness as the creates above (A4):
   * the same key with the same event replays and records nothing; the same
   * key with a different event throws. A NEW key carrying an identifier
   * already held is REFUSED with the invalid request Stripe test mode
   * returned to e2e/usage-meter.spec.ts's A11 probe ("An event already
   * exists with identifier <id>.") and records nothing. That probe resent
   * for the SAME customer under a fresh key within seconds; nothing more was
   * observed. The refusal here is keyed on the identifier alone, whatever
   * customer the new event names (assumption, unobserved: Stripe holds
   * identifiers per Stripe account), and it never lapses. Stripe's docs (an
   * external claim) promise identifier uniqueness only "within a rolling
   * period of at least 24 hours". Within that window the fake refuses as
   * Stripe was seen to (and, unobserved, across customers too). After it the
   * fake is possibly LOOSER than Stripe on the one hazard that costs money:
   * a real resend after about a day might be ACCEPTED and counted twice,
   * where the fake refuses it, so a test on this fake can never see that
   * double count. No test moves time today; PR-4's nightly reconciliation is
   * the backstop.
   */
  async reportMeterEvent(input: MeterEventInput, key: string): Promise<void> {
    meterEventParams(input);
    this.step("reportMeterEvent", input, key);
    const seen = this.replay.get(key);
    if (seen) {
      if (seen.op !== "reportMeterEvent" || !sameInput(seen.input, input)) {
        throw new Error(
          `fake Stripe: idempotency key "${key}" was already used for ${seen.op} with different parameters; ` +
            `Stripe itself rejects this with a 400 (assumption A4)`,
        );
      }
      return;
    }
    if (this.meterEvents.some((e) => e.identifier === input.identifier)) {
      throw Object.assign(new Error(`An event already exists with identifier ${input.identifier}.`), {
        type: "StripeInvalidRequestError", rawType: "invalid_request_error", statusCode: 400,
      });
    }
    this.replay.set(key, { op: "reportMeterEvent", input, value: undefined });
    this.meterEvents.push({ ...input });
  }

  /** Stripe's clock for sessions the fake makes (seconds). */
  clockSeconds = 1_790_000_000;
  readonly customers: Array<{ id: string; accountId: string; name: string | null; email: string }> = [];
  readonly checkoutSessions = new Map<string, CheckoutSession & { status: CheckoutStatus; input: CheckoutInput }>();
  /** Seed with the subscriptions a test's "Stripe" holds; retrieveSubscription reads here. */
  readonly subscriptions = new Map<string, SubscriptionSnapshot>();
  readonly subscriptionChanges: Array<{ change: SubscriptionPriceChange; key: string }> = [];
  portalConfigurations: PortalConfiguration[] = [];
  readonly portalSessions: PortalSessionInput[] = [];

  async createCustomer(input: { accountId: string; name: string | null; email: string }, key: string): Promise<{ id: string }> {
    this.step("createCustomer", input, key);
    return this.once("createCustomer", key, input, (id) => {
      this.customers.push({ id, ...input });
      return { id };
    });
  }

  async createCheckoutSession(input: CheckoutInput, key: string): Promise<CheckoutSession> {
    checkoutSessionParams(input);
    this.step("createCheckoutSession", input, key);
    return this.once("createCheckoutSession", key, input, (id) => {
      const session = { id, url: `https://checkout.stripe.test/c/pay/${id}`, expiresAt: this.clockSeconds + 86_400 };
      this.checkoutSessions.set(id, { ...session, status: "open", input });
      return session;
    });
  }

  async getCheckoutSessionStatus(sessionId: string): Promise<CheckoutStatus> {
    this.step("getCheckoutSessionStatus", { sessionId });
    const s = this.checkoutSessions.get(sessionId);
    if (!s) throw new Error(`fake Stripe: no such checkout session ${sessionId}`);
    return s.status;
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    this.step("expireCheckoutSession", { sessionId });
    const s = this.checkoutSessions.get(sessionId);
    if (!s || s.status !== "open") throw new Error(`fake Stripe: only an open session can be expired (${sessionId})`);
    s.status = "expired";
  }

  async retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot> {
    this.step("retrieveSubscription", { subscriptionId });
    const s = this.subscriptions.get(subscriptionId);
    if (!s) throw new Error(`fake Stripe: no such subscription ${subscriptionId}`);
    return structuredClone(s);
  }

  /** Same replay strictness as the creates (A4); applies the swap to the
   *  held subscription so a re-read after it sees the new plan. */
  async updateSubscriptionPrices(change: SubscriptionPriceChange, key: string): Promise<void> {
    this.step("updateSubscriptionPrices", change, key);
    const seen = this.replay.get(key);
    if (seen) {
      if (seen.op !== "updateSubscriptionPrices" || !sameInput(seen.input, change)) {
        throw new Error(`fake Stripe: idempotency key "${key}" was already used with different parameters (A4)`);
      }
      return;
    }
    this.replay.set(key, { op: "updateSubscriptionPrices", input: change, value: undefined });
    this.subscriptionChanges.push({ change, key });
    const sub = this.subscriptions.get(change.subscriptionId);
    if (!sub) throw new Error(`fake Stripe: no such subscription ${change.subscriptionId}`);
    for (const { id, price } of change.items) {
      const item = sub.items.find((i) => i.id === id);
      if (!item) throw new Error(`fake Stripe: no item ${id} on ${change.subscriptionId}`);
      item.priceId = price;
      item.planId = change.planId;
    }
    sub.planId = change.planId;
  }

  async listPortalConfigurations(): Promise<PortalConfiguration[]> {
    this.step("listPortalConfigurations");
    return this.portalConfigurations.map((c) => ({ ...c }));
  }

  async createPortalConfiguration(key: string): Promise<{ id: string }> {
    this.step("createPortalConfiguration", undefined, key);
    return this.once("createPortalConfiguration", key, { version: PORTAL_VERSION }, (id) => {
      this.portalConfigurations.push({ id, metadata: { bis_portal: PORTAL_VERSION } });
      return { id };
    });
  }

  async createPortalSession(input: PortalSessionInput): Promise<{ url: string }> {
    this.step("createPortalSession", input);
    this.portalSessions.push(input);
    return { url: `https://billing.stripe.test/p/session/${input.customerId}` };
  }
}
