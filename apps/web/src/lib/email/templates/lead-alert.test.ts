import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { leadAlertEmail } from "./lead-alert";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });
const answers = [
  { label: "Email", value: "customer@example.com" },
  { label: "Message", value: "Need a quote for a new roof" },
];
const URL = "https://bis-platform-six.vercel.app/dashboard/accounts/acct_1/contacts/contact_1";

describe("leadAlertEmail", () => {
  it("carries every answer in both parts", () => {
    const { html, text } = leadAlertEmail({
      brand, formName: "Roof quote", answers, contactUrl: URL,
    });
    for (const a of answers) {
      expect(html).toContain(a.label);
      expect(html).toContain(a.value);
      expect(text).toContain(a.value);
    }
  });

  // The defect this whole task exists for: the body used to end with a bare
  // `/dashboard/...` path, which no email client renders as a link.
  it("links the contact ABSOLUTELY, in both parts", () => {
    const { html, text } = leadAlertEmail({
      brand, formName: "Roof quote", answers, contactUrl: URL,
    });
    expect(html).toContain(`href="${URL}"`);
    expect(text).toContain(URL);
    expect(html).not.toMatch(/href="\/dashboard/);
  });

  it("omits the link entirely rather than emitting a relative path", () => {
    const { html, text } = leadAlertEmail({
      brand, formName: "Roof quote", answers, contactUrl: null,
    });
    expect(html).not.toContain("<a href");
    expect(text).not.toContain("/dashboard/");
    // The lead itself must still arrive. Losing the link must never lose the lead.
    expect(text).toContain("customer@example.com");
  });

  it("never returns an empty text part", () => {
    const { text } = leadAlertEmail({
      brand, formName: "Roof quote", answers: [], contactUrl: null,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  // A form field is the one place in this product where an untrusted stranger
  // types text that a client later opens in an email client.
  it("escapes an answer that contains markup", () => {
    const { html } = leadAlertEmail({
      brand, formName: "Roof quote",
      answers: [{ label: "Message", value: "<img src=x onerror=alert(1)>" }],
      contactUrl: null,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
