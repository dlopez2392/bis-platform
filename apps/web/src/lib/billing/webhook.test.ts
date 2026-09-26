import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubscriptionSnapshot } from "@bis/db";

const db = vi.hoisted(() => ({
  claimWebhookEvent: vi.fn(),
  markWebhookEventProcessed: vi.fn(),
  mirrorSubscription: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

const { processStripeEvent } = await import("./webhook");
const { FakeGateway } = await import("./fake-gateway");

const NOW = new Date("2026-10-01T12:00:00.000Z");
const SUB: SubscriptionSnapshot = {
  id: "sub_1", customerId: "cus_1", status: "past_due", accountId: "acct", planId: "plan",
  currentPeriodStart: 1, currentPeriodEnd: 2, startedAt: 1, items: [],
};
const event = (over: Partial<{ id: string; type: string; livemode: boolean; subscriptionId: string | null }> = {}) => ({
  id: "evt_1", type: "invoice.payment_failed", livemode: false, subscriptionId: "sub_1", ...over,
});

let gateway: InstanceType<typeof FakeGateway>;
/** What each mirror call's reader returned. The mocked mirror reads Stripe
 *  once through the reader it was handed, like one attempt of the real one. */
let mirrored: SubscriptionSnapshot[];
const deps = () => ({ db: {} as never, gateway, live: false, now: () => NOW });

beforeEach(() => {
  gateway = new FakeGateway();
  gateway.subscriptions.set("sub_1", structuredClone(SUB));
  mirrored = [];
  db.claimWebhookEvent.mockReset().mockResolvedValue("new");
  db.markWebhookEventProcessed.mockReset().mockResolvedValue(undefined);
  db.mirrorSubscription.mockReset().mockImplementation(async (_db: unknown, read: () => Promise<SubscriptionSnapshot>) => {
    const s = await read();
    mirrored.push(s);
    return { kind: "written", accountId: s.accountId, planId: s.planId, status: s.status };
  });
});

describe("processStripeEvent", () => {
  it("mirrors what Stripe SAYS NOW, re-read by id, never the event: the mirror's reader is the gateway's retrieveSubscription for the event's subscription, the event is claimed and stamped by its OWN id, and stamped after the mirror (mutation: hand the mirror a reader that returns the event's own data → retrieveSubscription is never called, FAILS; stamp before mirroring → FAILS; claim or stamp by the subscription id → FAILS)", async () => {
    expect(await processStripeEvent(deps(), event())).toEqual({ status: "processed", accountId: "acct" });
    expect(gateway.calls.map((c) => c.op)).toEqual(["retrieveSubscription"]);
    expect(mirrored).toEqual([SUB]);
    expect(db.mirrorSubscription.mock.calls[0]![0]).toEqual({});
    expect(db.claimWebhookEvent).toHaveBeenCalledWith({}, "evt_1", "invoice.payment_failed");
    expect(db.markWebhookEventProcessed).toHaveBeenCalledWith({}, "evt_1", NOW);
    expect(db.mirrorSubscription.mock.invocationCallOrder[0]!)
      .toBeLessThan(db.markWebhookEventProcessed.mock.invocationCallOrder[0]!);
  });

  it("a DUPLICATE (already stamped) is acknowledged without reading Stripe or writing anything (mutation: ignore 'done' → FAILS)", async () => {
    db.claimWebhookEvent.mockResolvedValue("done");
    expect(await processStripeEvent(deps(), event())).toEqual({ status: "duplicate" });
    expect(gateway.calls).toEqual([]);
    expect(db.mirrorSubscription).not.toHaveBeenCalled();
    expect(db.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("a RETRY (stored, never stamped: an earlier attempt threw) is processed again in full (mutation: treat 'retry' like 'done' → a failed event is lost forever, FAILS)", async () => {
    db.claimWebhookEvent.mockResolvedValue("retry");
    expect((await processStripeEvent(deps(), event())).status).toBe("processed");
    expect(db.mirrorSubscription).toHaveBeenCalledTimes(1);
  });

  it("out of order converges on Stripe's CURRENT state: `invoice.paid` processed first mirrors what Stripe said then (active); the subscription's OLDER `created` event, delivered after Stripe has moved on to past_due, mirrors past_due, not anything tied to its type or age (G5) (mutation: treat a subscription's 'created' as nothing to follow → it is ignored, FAILS; remember a subscription's first read across deliveries → the late event mirrors 'active', FAILS)", async () => {
    gateway.subscriptions.set("sub_1", { ...SUB, status: "active" });
    await processStripeEvent(deps(), event({ id: "evt_paid", type: "invoice.paid" }));
    gateway.subscriptions.set("sub_1", { ...SUB, status: "past_due" });
    expect(await processStripeEvent(deps(), event({ id: "evt_created", type: "customer.subscription.created" })))
      .toEqual({ status: "processed", accountId: "acct" });
    expect(mirrored.map((s) => s.status)).toEqual(["active", "past_due"]);
    expect(gateway.calls.map((c) => c.op)).toEqual(["retrieveSubscription", "retrieveSubscription"]);
  });

  it("an event with no subscription to follow (an unhandled type, a payment-mode checkout) is stamped and ignored, with no Stripe read (mutation: leave it unstamped → Stripe's retry reprocesses it forever, FAILS)", async () => {
    expect(await processStripeEvent(deps(), event({ type: "customer.updated", subscriptionId: null }))).toEqual({ status: "ignored" });
    expect(gateway.calls).toEqual([]);
    expect(db.markWebhookEventProcessed).toHaveBeenCalledWith({}, "evt_1", NOW);
  });

  it("a REFUSED mirror is stamped (a retry cannot fix it) and logged; an event from the wrong MODE is not even recorded (mutation: leave a refusal unstamped → FAILS; record a wrong-mode event → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.mirrorSubscription.mockResolvedValue({ kind: "refused", reason: "customer_mismatch" });
    expect(await processStripeEvent(deps(), event())).toEqual({ status: "refused", reason: "customer_mismatch" });
    expect(db.markWebhookEventProcessed).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(" ")).toContain("customer_mismatch");
    db.claimWebhookEvent.mockClear();
    expect(await processStripeEvent(deps(), event({ livemode: true }))).toEqual({ status: "mode_mismatch" });
    expect(db.claimWebhookEvent).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("a Stripe read that FAILS propagates and leaves the event UNSTAMPED, so Stripe's retry processes it (mutation: stamp in a finally → the event is marked done and never retried, FAILS)", async () => {
    gateway.failOn = { op: "retrieveSubscription" };
    await expect(processStripeEvent(deps(), event())).rejects.toThrow(/refused retrieveSubscription/);
    expect(db.markWebhookEventProcessed).not.toHaveBeenCalled();
  });
});
