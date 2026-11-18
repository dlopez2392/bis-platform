import { describe, it, expect } from "vitest";
import { checkinAlertEmail } from "./checkin-alert";
import type { EmailBrand } from "./shell";

const brand: EmailBrand = {
  name: "Rio Roofing", logoUrl: "https://cdn.example.com/rio.png",
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const URL = "https://app.example.com/dashboard/accounts/a1/contacts/c1";
const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("checkinAlertEmail (F-072, owner decision 2026-11-17)", () => {
  it("English: names the customer and the day, says it is on the To do list, one button to the record", () => {
    const { subject, html, text } = checkinAlertEmail({ brand, customerName: "Ana García", day: "Tue, Jun 15", contactUrl: URL });
    expect(subject).toBe("Ana García said the job was not great");
    expect(html).toContain("Ana García said the job on Tue, Jun 15 was not great.");
    expect(html).toContain("A call to this customer is on your To do list.");
    expect(html).toContain(">Open this contact</a>");
    expect(hrefsOf(html)).toEqual([URL]);
    expect(text).toBe(`Ana García said the job on Tue, Jun 15 was not great.\n\nA call to this customer is on your To do list.\n\nOpen this contact: ${URL}`);
  });

  it("Spanish, usted: subject through button", () => {
    const { subject, html, text } = checkinAlertEmail({ brand, customerName: "Ana García", day: "mar, 15 jun", contactUrl: URL, locale: "es" });
    expect(subject).toBe("Ana García dijo que el trabajo no estuvo bien");
    expect(html).toContain("Ana García dijo que el trabajo del mar, 15 jun no estuvo bien.");
    expect(html).toContain(">Abrir este contacto</a>");
    expect(text).toContain("en su lista de Pendientes");
  });

  it("no day: the sentence names no day (never an empty one); no name: 'A customer', never a blank", () => {
    const { subject, html } = checkinAlertEmail({ brand, customerName: null, day: null, contactUrl: URL });
    expect(subject).toBe("A customer said the job was not great");
    expect(html).toContain("A customer said the job was not great.");
    expect(html).not.toMatch(/job on\s/);
    expect(checkinAlertEmail({ brand, customerName: "  ", day: null, contactUrl: URL, locale: "es" }).subject)
      .toBe("Un cliente dijo que el trabajo no estuvo bien");
  });

  it("no link (APP_ORIGIN unset): the alert still goes, without a button and without a bare path", () => {
    const { html, text } = checkinAlertEmail({ brand, customerName: "Ana", day: "Tue, Jun 15", contactUrl: null });
    expect(hrefsOf(html)).toEqual([]);
    expect(html).not.toContain("Open this contact");
    expect(text).not.toContain("Open this contact");
    expect(text).not.toContain("/dashboard");
  });

  it("the customer's name is escaped in the HTML and cannot break the subject header", () => {
    const { subject, html } = checkinAlertEmail({ brand, customerName: "<b>Eve</b>\r\nBcc: x@y.z", day: null, contactUrl: null });
    expect(html).not.toContain("<b>Eve</b>");
    expect(html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("shows no customer address or phone, carries the brand's logo (rule 9), no internal codes, no template syntax, no arrows", () => {
    for (const locale of ["en", "es"] as const) {
      const { subject, html, text } = checkinAlertEmail({ brand, customerName: "Ana", day: "Tue, Jun 15", contactUrl: URL, locale });
      expect(html).toContain("https://cdn.example.com/rio.png");
      for (const s of [subject, html, text]) {
        expect(s).not.toMatch(INTERNAL_MILESTONE);
        expect(s).not.toMatch(/\{\{|\{[a-z]+\}/);
        expect(s).not.toMatch(/[→←↑↓]|@[a-z]+\./i);
      }
    }
  });
});
