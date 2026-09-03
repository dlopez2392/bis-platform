import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { leadReceiptEmail, leadReceiptSubject } from "./lead-receipt";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Acme");

describe("leadReceiptEmail", () => {
  it("greets by first name and says the message arrived, in both parts", () => {
    const { html, text } = leadReceiptEmail({ brand, locale: "en", firstName: "Maria", canReply: true });
    expect(html).toContain("Hi Maria,");
    expect(html).toContain("We received your message");
    expect(text).toContain("Hi Maria,");
    expect(text).toContain("We received your message");
    // The brand header, never the agency's internal label.
    expect(html).toContain("Rio Roofing");
    expect(html).not.toContain("Acme");
  });

  it("speaks Spanish when the form was submitted in Spanish", () => {
    const { html, text } = leadReceiptEmail({ brand, locale: "es", firstName: "María", canReply: true });
    expect(html).toContain("Hola María:");
    expect(html).toContain("Recibimos tu mensaje");
    expect(text).toContain("responde a este correo");
    expect(html).not.toContain("We received");
  });

  it("greets without a name when the form asked for none or it was left blank", () => {
    expect(leadReceiptEmail({ brand, locale: "en", firstName: null, canReply: true }).text).toMatch(/^Hi,/);
    expect(leadReceiptEmail({ brand, locale: "en", firstName: "   ", canReply: true }).text).toMatch(/^Hi,/);
    expect(leadReceiptEmail({ brand, locale: "es", firstName: null, canReply: true }).text).toMatch(/^Hola:/);
  });

  it("only invites a reply when a reply would actually reach the company", () => {
    const yes = leadReceiptEmail({ brand, locale: "en", firstName: null, canReply: true });
    const no = leadReceiptEmail({ brand, locale: "en", firstName: null, canReply: false });
    expect(yes.html).toContain("reply to this email");
    expect(yes.text).toContain("reply to this email");
    expect(no.html).not.toContain("reply to this email");
    expect(no.text).not.toContain("reply to this email");
  });

  it("escapes an attacker-supplied first name", () => {
    const { html, text } = leadReceiptEmail({
      brand, locale: "en", firstName: "<img src=x onerror=alert(1)>", canReply: false,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(text).toContain("<img src=x onerror=alert(1)>");
  });

  it("subjects carry the brand name in the right language", () => {
    expect(leadReceiptSubject("en", "Rio Roofing")).toBe("We received your message — Rio Roofing");
    expect(leadReceiptSubject("es", "Rio Roofing")).toBe("Recibimos tu mensaje — Rio Roofing");
  });
});
