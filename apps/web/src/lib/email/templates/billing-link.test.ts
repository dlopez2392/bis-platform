import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrandNamed } from "./shell";
import { billingLinkEmail } from "./billing-link";

const BIS: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};
const URL = "https://checkout.stripe.com/c/pay/cs_test_a1?x=1&y=2";
const input = {
  brand: emailBrandNamed(BIS, "BIS"), businessName: "Rio Roofing" as string | null, planName: "Growth",
  price: "$149.00/month", includes: "It includes 500 minutes of calls, 1,000 texts and 200 website chats each month.",
  url: URL, expires: "Oct 16, 3:30 PM",
};

describe("billingLinkEmail", () => {
  it("names the business in the subject when it has a customer-facing name, and falls back to plain words, never an internal label (mutation: fall back to accounts.name-style text → FAILS)", () => {
    expect(billingLinkEmail(input).subject).toBe("Set up billing for Rio Roofing");
    expect(billingLinkEmail({ ...input, businessName: null }).subject).toBe("Set up your billing");
  });

  it("carries the ABSOLUTE link in both parts, escaped in the HTML (mutation: drop the link from the text part → a text-only client gets no way to pay, FAILS)", () => {
    const { html, text } = billingLinkEmail(input);
    expect(html).toContain(`href="${URL.replace(/&/g, "&amp;")}"`);
    expect(text).toContain(URL);
  });

  it("says what they are buying, in plain words: plan, price, what's included and when the link stops working, with no template syntax and no payment-vendor jargon (mutation: drop the expiry sentence → FAILS; name the vendor or its Checkout/subscription terms in the copy → FAILS)", () => {
    const { html, text } = billingLinkEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain("Growth");
      expect(part).toContain("$149.00/month");
      expect(part).toContain("500 minutes of calls");
      expect(part).toContain("Oct 16, 3:30 PM");
      expect(part).not.toMatch(/\{\{|\{[a-z]+\}/);
    }
    // The copy only: the URL itself is Stripe's host, so it is cut out first.
    for (const copy of [html.split(URL.replace(/&/g, "&amp;")).join(""), text.split(URL).join("")]) {
      expect(copy).not.toMatch(/stripe|checkout|subscription|portal|session/i);
    }
  });
});
