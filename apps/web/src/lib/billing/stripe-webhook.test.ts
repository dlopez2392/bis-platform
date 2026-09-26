import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { isSignatureError, STRIPE_API_VERSION, verifyWebhookEvent } from "./stripe-gateway";

/**
 * Webhook verification against the REAL Stripe SDK: signed with its own
 * generateTestHeaderString, verified by its own constructEvent. Its own file
 * on purpose: stripe-gateway.test.ts replaces the "stripe" module with a
 * stub class (vi.mock), under which Stripe.webhooks does not exist.
 */
describe("verifyWebhookEvent (the real SDK, signed fixtures)", () => {
  const SECRET = "whsec_unit_fixture";
  const payload = JSON.stringify({
    id: "evt_1", object: "event", type: "invoice.payment_failed", livemode: false, api_version: STRIPE_API_VERSION,
    data: { object: { id: "in_1", object: "invoice", parent: { subscription_details: { subscription: "sub_9" } } } },
  });

  it("accepts a correctly signed payload and returns the id, type, mode and the ONE subscription id to re-read (mutation: return the payload's status or any other field → the shape FAILS)", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(verifyWebhookEvent(payload, header, SECRET)).toStrictEqual({
      id: "evt_1", type: "invoice.payment_failed", livemode: false, subscriptionId: "sub_9",
    });
  });

  it("passes livemode through as the event says: a LIVE event reads true (mutation: hard-code livemode false → a live endpoint refuses every event, FAILS)", () => {
    const live = JSON.stringify({
      id: "evt_live", object: "event", type: "invoice.paid", livemode: true,
      data: { object: { id: "in_2", object: "invoice", parent: { subscription_details: { subscription: "sub_7" } } } },
    });
    expect(verifyWebhookEvent(live, Stripe.webhooks.generateTestHeaderString({ payload: live, secret: SECRET }), SECRET))
      .toStrictEqual({ id: "evt_live", type: "invoice.paid", livemode: true, subscriptionId: "sub_7" });
  });

  it("isSignatureError is false for anything that is not a signature failure: null, a plain Error, and the SDK's own non-signature error (mutation: drop the .type comparison → FAILS)", () => {
    expect(isSignatureError(null)).toBe(false);
    expect(isSignatureError(new Error("boom"))).toBe(false);
    expect(isSignatureError(new Stripe.errors.StripeInvalidRequestError({ message: "No such customer" }))).toBe(false);
  });

  it("throws on a tampered body, the wrong secret, a stale timestamp and a missing header, each as a signature error (mutation: JSON.parse first and verify re-serialised → the one-space tamper still verifies, FAILS)", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const stale = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 600 });
    for (const [body, sig, secret] of [[`${payload} `, header, SECRET], [payload, header, "whsec_other"], [payload, stale, SECRET], [payload, "", SECRET]]) {
      let caught: unknown = null;
      try { verifyWebhookEvent(body!, sig!, secret!); } catch (e) { caught = e; }
      expect(isSignatureError(caught)).toBe(true);
    }
  });

  it("maps each handled type to its subscription, and everything else to null: payment-mode checkouts, unhandled types, a legacy top-level invoice.subscription still maps (B7) (mutation: drop the legacy fallback → FAILS; map a payment-mode session → FAILS)", () => {
    const signed = (obj: object, type: string) => {
      const p = JSON.stringify({ id: "evt_x", object: "event", type, livemode: true, data: { object: obj } });
      return verifyWebhookEvent(p, Stripe.webhooks.generateTestHeaderString({ payload: p, secret: SECRET }), SECRET).subscriptionId;
    };
    expect(signed({ object: "checkout.session", mode: "subscription", subscription: "sub_c" }, "checkout.session.completed")).toBe("sub_c");
    expect(signed({ object: "checkout.session", mode: "payment", subscription: "sub_p" }, "checkout.session.completed")).toBeNull();
    for (const t of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
      expect(signed({ id: "sub_s", object: "subscription" }, t)).toBe("sub_s");
    }
    expect(signed({ id: "in_1", object: "invoice", parent: null, subscription: "sub_legacy" }, "invoice.paid")).toBe("sub_legacy");
    expect(signed({ id: "cus_1", object: "customer" }, "customer.updated")).toBeNull();
  });
});
