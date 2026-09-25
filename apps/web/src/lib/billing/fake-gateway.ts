import type { BillingGateway, PriceSpec, StripeMeter } from "./stripe-gateway";

export type GatewayOp = "listActiveMeters" | "createMeter" | "createProduct" | "renameProduct" | "createPrice";

/**
 * In-memory Stripe for unit tests. It mirrors the ONE Stripe behaviour the
 * catalog depends on (assumption A4): a create sent with an idempotency key
 * seen before returns the FIRST result and creates nothing new.
 *
 *   calls    every call, replays included, in order
 *   created  only calls that made something new (id minted)
 *   failOn   throw on the (after + 1)th call of `op`, and every one after
 */
export class FakeGateway implements BillingGateway {
  meters: StripeMeter[] = [];
  readonly calls: Array<{ op: GatewayOp; key?: string; input?: unknown }> = [];
  readonly created: Array<{ op: GatewayOp; input: unknown; id: string }> = [];
  failOn: { op: GatewayOp; after?: number } | null = null;
  private seq = 0;
  private readonly replay = new Map<string, unknown>();
  private readonly counts = new Map<GatewayOp, number>();

  private step(op: GatewayOp, input?: unknown, key?: string): void {
    this.calls.push({ op, key, input });
    const n = (this.counts.get(op) ?? 0) + 1;
    this.counts.set(op, n);
    if (this.failOn && this.failOn.op === op && n > (this.failOn.after ?? 0)) {
      throw new Error(`fake Stripe refused ${op}`);
    }
  }

  private once<T extends { id: string }>(op: GatewayOp, key: string, input: unknown, make: (id: string) => T): T {
    const seen = this.replay.get(key);
    if (seen) return seen as T;
    const prefix = op === "createMeter" ? "mtr" : op === "createProduct" ? "prod" : "price";
    const value = make(`${prefix}_${++this.seq}`);
    this.replay.set(key, value);
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
    this.step("createPrice", spec, key);
    return this.once("createPrice", key, spec, (id) => ({ id }));
  }
}
