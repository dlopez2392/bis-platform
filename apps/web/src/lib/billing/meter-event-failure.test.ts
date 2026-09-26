import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { meterEventFailureKind } from "./stripe-gateway";

/**
 * stripe-gateway.test.ts mocks the `stripe` module, so its classification
 * test can only use Stripe-SHAPED errors. This file uses the REAL classes the
 * SDK throws, so a `.type` rename in an SDK upgrade cannot pass unnoticed.
 */
describe("meterEventFailureKind against the installed SDK's own error classes", () => {
  it("classifies the SDK's real errors (mutation: match on the class name via instanceof a local copy, or on .code → FAILS)", () => {
    const E = Stripe.errors;
    expect(meterEventFailureKind(new E.StripeInvalidRequestError({ message: "No such customer" }), "u_1")).toBe("row");
    expect(meterEventFailureKind(new E.StripeIdempotencyError({ message: "Keys for idempotent requests" }), "u_1")).toBe("row");
    expect(meterEventFailureKind(new E.StripeRateLimitError({ message: "Too many requests" }), "u_1")).toBe("systemic");
    expect(meterEventFailureKind(new E.StripeAuthenticationError({ message: "Invalid API key" }), "u_1")).toBe("systemic");
    expect(meterEventFailureKind(new E.StripeConnectionError({ message: "socket hang up" }), "u_1")).toBe("systemic");
  });

  // The message is the one Stripe TEST mode returned to e2e/usage-meter.spec.ts's
  // A11 probe (the same identifier under a new idempotency key). The SDK builds
  // `.message` from the raw error, so a real StripeInvalidRequestError built
  // from that raw shape is exactly what the pass receives.
  const ID = "5b0c2c4e-8f3a-4d2e-9a61-0f6f1b7c9d10";
  const alreadyThere = (id: string) => new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error", message: `An event already exists with identifier ${id}.`,
  });

  it("Stripe's refusal of an identifier it already holds, naming the identifier SENT, is a duplicate: the event is already at Stripe (mutation: drop the duplicate class → 'row', FAILS)", () => {
    expect(meterEventFailureKind(alreadyThere(ID), ID)).toBe("duplicate");
  });

  it("matches the message case-insensitively, as the brief for this fix asked (mutation: a case-sensitive match → 'row', FAILS)", () => {
    const shouted = new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error", message: `AN EVENT ALREADY EXISTS WITH IDENTIFIER ${ID}.`,
    });
    expect(meterEventFailureKind(shouted, ID)).toBe("duplicate");
  });

  it("the same refusal naming a DIFFERENT identifier is not ours to stamp: it stays a row refusal (mutation: skip the identifier comparison → 'duplicate', FAILS)", () => {
    expect(meterEventFailureKind(alreadyThere("some-other-row"), ID)).toBe("row");
    // A prefix of the id we sent is a different identifier too.
    expect(meterEventFailureKind(alreadyThere(ID.slice(0, 8)), ID)).toBe("row");
    expect(meterEventFailureKind(alreadyThere(`${ID}-2`), ID)).toBe("row");
  });

  it("an unrelated invalid request, and the duplicate's words on any other error class, are not duplicates (mutation: match the message without the type → the rate-limit case is 'duplicate', FAILS)", () => {
    expect(meterEventFailureKind(new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error", message: "No such customer: 'cus_gone'",
    }), ID)).toBe("row");
    expect(meterEventFailureKind(new Stripe.errors.StripeRateLimitError({
      message: `An event already exists with identifier ${ID}.`,
    }), ID)).toBe("systemic");
  });
});
