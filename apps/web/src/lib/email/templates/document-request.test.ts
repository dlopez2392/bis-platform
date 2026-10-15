import { describe, it, expect } from "vitest";
import { documentRequestEmail, requestCopy } from "./document-request";
import { m, type MessageKey } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
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

  it.each([
    ["en", "We need a few documents from you", "Please send us: Insurance."],
    ["es", "Le pedimos unos documentos", "Por favor envíenos: Seguro."],
  ] as const)("no brand name (%s): the subject is its own whole sentence, never 'the business'/'el negocio' filled in (fix round 2; mutation: always use the {business} key -> FAILS)", (locale, subject, body) => {
    const mail = documentRequestEmail({ brand: { ...brand, name: "" }, business: "", items: locale === "es" ? "Seguro" : "Insurance", url: URL, locale });
    expect(mail.subject).toBe(subject);
    expect(mail.text).toContain(body);
  });

  it("EVERY documentRequest key that names {business} has a no-name sentence in both languages, and with no name it renders no '{', no 'a el'/'de el' and no lower-case opening (a key added later without one -> FAILS here)", () => {
    const named = (Object.keys(m) as MessageKey[]).filter((k) => k.startsWith("documentRequest.") && !k.endsWith(".es")
      && (m[k].includes("{business}") || (m[`${k}.es` as MessageKey] ?? "").includes("{business}")));
    expect(named.sort()).toEqual(["documentRequest.email.subject", "documentRequest.sms"]);
    for (const k of named) {
      for (const locale of ["en", "es"] as const) {
        const s = requestCopy(locale, null)(k, { items: "Seguro" });
        expect(s, `${k} (${locale})`).not.toContain("{");
        expect(s, `${k} (${locale})`).not.toMatch(/\b(a|de) el\b/);
        expect(s, `${k} (${locale})`).not.toMatch(/^(the|el) /i);
        expect(s, `${k} (${locale})`).not.toMatch(/^\p{Ll}/u);
        expect(s, `${k} (${locale})`).not.toMatch(/business|negocio/i);
      }
    }
  });

  it("the Spanish no-name text keeps to GSM-7 with its opt-out line, as every Spanish text default does (mutation: write 'aquí' into it -> FAILS)", () => {
    const text = requestCopy("es", null)("documentRequest.sms", { items: "Seguro, Contrato" });
    expect(segmentsFor(withOptOut(text, "es")).encoding).toBe("gsm7");
  });

  it("with a brand name, requestCopy fills the {business} sentence; a blank name counts as none", () => {
    expect(requestCopy("es", "Casa Verde")("documentRequest.email.subject")).toBe("Casa Verde necesita unos documentos");
    expect(requestCopy("en", null)("documentRequest.email.button")).toBe("Upload documents");
    const blank = documentRequestEmail({ brand: { ...brand, name: "" }, business: "   ", items: "Seguro", url: URL, locale: "es" });
    expect(blank.subject).toBe("Le pedimos unos documentos");
  });

  it("wears the client's brand: the shell's brand name in the html and the button in the brand's accent (DESIGN.md rule 9)", () => {
    const { html } = documentRequestEmail({ brand, business: "Casa Verde", items: "Seguro", url: URL, locale: "es" });
    expect(renderedText(html)).toContain("Casa Verde");
    expect(html).toContain("background-color:#1e3a8a;");
  });
});
