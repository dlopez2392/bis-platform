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
    expect(meterEventFailureKind(new E.StripeInvalidRequestError({ message: "No such customer" }))).toBe("row");
    expect(meterEventFailureKind(new E.StripeIdempotencyError({ message: "Keys for idempotent requests" }))).toBe("row");
    expect(meterEventFailureKind(new E.StripeRateLimitError({ message: "Too many requests" }))).toBe("systemic");
    expect(meterEventFailureKind(new E.StripeAuthenticationError({ message: "Invalid API key" }))).toBe("systemic");
    expect(meterEventFailureKind(new E.StripeConnectionError({ message: "socket hang up" }))).toBe("systemic");
  });
});
