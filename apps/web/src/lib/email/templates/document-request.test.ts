import { describe, it, expect } from "vitest";
import { documentRequestEmail } from "./document-request";
import { renderedText } from "@/lib/rendered-text";
import type { EmailBrand } from "./shell";

const brand: EmailBrand = {
  name: "Casa Verde", logoUrl: null,
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const URL = "https://app.example.com/d/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";

describe("documentRequestEmail (spec 4.2): one language end to end, the client's brand", () => {
  it("in Spanish: subject, body, button and link are all Spanish, and no English twin leaks into the html (DESIGN.md 'one message is in one language'; mutation: an English button in the Spanish email -> FAILS)", () => {
    const { subject, html, text } = documentRequestEmail({ brand, business: "Casa Verde", items: "Seguro, Pool permit", url: URL, locale: "es" });
    expect(subject).toBe("Casa Verde necesita unos documentos");
    expect(text).toContain("Por favor envíenos: Seguro, Pool permit.");
    expect(text).toContain(URL);
    expect(html).toContain(`href="${URL}"`);
    const visible = renderedText(html);
    expect(visible).toContain("Subir documentos");
    expect(visible).toContain("Por favor envíenos: Seguro, Pool permit.");
    expect(visible).not.toContain("Upload documents");
    expect(visible).not.toContain("needs a few");
    expect(visible).not.toContain("Please send us");
    expect(subject).not.toContain("needs a few");
  });

  it("in English: the mirror, with no Spanish twin in the html (mutation: a Spanish button in the English email -> FAILS)", () => {
    const { subject, html, text } = documentRequestEmail({ brand, business: "Casa Verde", items: "Insurance, Pool permit", url: URL, locale: "en" });
    expect(subject).toBe("Casa Verde needs a few documents");
    expect(text).toContain("Please send us: Insurance, Pool permit.");
    expect(text).toContain(URL);
    expect(html).toContain(`href="${URL}"`);
    const visible = renderedText(html);
    expect(visible).toContain("Upload documents");
    expect(visible).not.toContain("Subir documentos");
    expect(visible).not.toContain("necesita unos");
    expect(visible).not.toContain("Por favor");
  });

  it("wears the client's brand: the shell's brand name in the html and the button in the brand's accent (DESIGN.md rule 9)", () => {
    const { html } = documentRequestEmail({ brand, business: "Casa Verde", items: "Seguro", url: URL, locale: "es" });
    expect(renderedText(html)).toContain("Casa Verde");
    expect(html).toContain("background-color:#1e3a8a;");
  });
});
