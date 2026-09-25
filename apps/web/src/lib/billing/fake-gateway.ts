import {
  priceCreateParams, meterEventParams, type BillingGateway, type MeterEventInput, type PriceSpec, type StripeMeter,
} from "./stripe-gateway";

export type GatewayOp =
  | "listActiveMeters" | "createMeter" | "createProduct" | "renameProduct" | "createPrice" | "reportMeterEvent";

/** Structural equality good enough for the plain (no-array) op inputs this
 *  fake ever stores: PriceSpec and the {planId,name}/{eventName,displayName}
 *  input shapes. Not a general deep-equal utility; do not reuse elsewhere. */
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
 *   meterEvents  the meter events Stripe would hold: one per accepted key,
 *            even when two keys carry one identifier (A11 is not assumed)
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
    const prefix = op === "createMeter" ? "mtr" : op === "createProduct" ? "prod" : "price";
    const value = make(`${prefix}_${++this.seq}`);
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
   * key with a different event throws. A NEW key records a NEW event, even
   * when its identifier is one already held: whether Stripe dedupes an
   * identifier across keys is assumption A11, which only Task 10's e2e
   * observes, so this fake assumes the costlier answer (the rule in the
   * class doc: never looser than what it fakes). A test that passes here
   * cannot be relying on a dedupe Stripe may not do.
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
    this.replay.set(key, { op: "reportMeterEvent", input, value: undefined });
    this.meterEvents.push({ ...input });
  }
}
