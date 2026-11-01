import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { leadAlertEmail, leadAlertSubject } from "./lead-alert";

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

  // S-10 T8: subject, heading, body and button in Spanish, in both parts
  // (mutation: call t() with a hard-coded "en" at any one of the four
  // template call sites → FAILS, because that site's English string would
  // then show up instead of its Spanish twin below).
  it("renders in Spanish — subject, heading, body and button, in both html and text (mutation: hard-code \"en\" at any t() call in the file → FAILS)", () => {
    expect(leadAlertSubject("Roof quote", "es")).toBe("Nuevo cliente potencial: Roof quote");
    const { html, text } = leadAlertEmail({
      brand, formName: "Roof quote", answers, contactUrl: URL, locale: "es",
    });
    expect(html).toContain("Nuevo cliente potencial");
    expect(html).toContain("De su formulario &ldquo;Roof quote&rdquo;.");
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain(">Abrir este contacto<");
    expect(text).toBe(
      'Nuevo cliente potencial de su formulario "Roof quote".\n\n'
      + "Email: customer@example.com\nMessage: Need a quote for a new roof\n\n"
      + `Abrir este contacto: ${URL}`,
    );
  });

  it("English is unaffected when locale is omitted (mutation: change the default param to \"es\" → FAILS)", () => {
    expect(leadAlertSubject("Roof quote")).toBe("New lead: Roof quote");
    const { html, text } = leadAlertEmail({ brand, formName: "Roof quote", answers, contactUrl: URL });
    expect(html).toContain("New lead");
    expect(text).toContain('New lead from your form "Roof quote".');
  });
});
