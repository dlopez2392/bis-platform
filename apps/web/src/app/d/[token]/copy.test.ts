import { describe, it, expect } from "vitest";
import { m, type MessageKey } from "@/lib/messages";
import { docCopy } from "./copy";

const PHONE = { phone: "(956) 555-0123" };

describe("docCopy: the page's words, with a brand name or without one", () => {
  it("with a brand name: the {business} sentence, filled", () => {
    expect(docCopy("en", "Casa Verde")("customerDocs.ask")).toBe("Ask Casa Verde for a new link.");
    expect(docCopy("es", "Casa Verde")("customerDocs.call", PHONE)).toBe("¿Preguntas? Llame a Casa Verde al (956) 555-0123.");
  });

  it.each<[MessageKey, string, string]>([
    ["customerDocs.heading", "The business asks for these documents", "El negocio le pide estos documentos"],
    ["customerDocs.intro", "Upload each one below. Only the business will see them.", "Suba cada uno abajo. Solo el negocio los verá."],
    ["customerDocs.why.full", "Please call the business at (956) 555-0123.", "Por favor llame al negocio al (956) 555-0123."],
    ["customerDocs.why.fullNoPhone", "Please call the business.", "Por favor llame al negocio."],
    ["customerDocs.done", "Thank you. The business has everything it asked for.", "Gracias. El negocio ya tiene todo lo que pidió."],
    ["customerDocs.ask", "Ask the business for a new link.", "Pida al negocio un enlace nuevo."],
    ["customerDocs.call", "Questions? Call the business at (956) 555-0123.", "¿Preguntas? Llame al negocio al (956) 555-0123."],
    ["customerDocs.callNoPhone", "Questions? Contact the business.", "¿Preguntas? Comuníquese con el negocio."],
  ])("no brand name: %s reads its own sentence, never 'a el' nor a lower-case opening (mutation: always use the {business} key → FAILS)", (key, en, es) => {
    expect(docCopy("en", null)(key, PHONE)).toBe(en);
    expect(docCopy("es", null)(key, PHONE)).toBe(es);
  });

  it("EVERY customerDocs key that names {business} has a no-name sentence, in both languages (a key added later without one → FAILS here)", () => {
    const named = (Object.keys(m) as MessageKey[]).filter((k) => k.startsWith("customerDocs.") && !k.endsWith(".es")
      && (m[k].includes("{business}") || (m[`${k}.es` as MessageKey] ?? "").includes("{business}")));
    expect(named.length).toBeGreaterThanOrEqual(8);
    for (const k of named) {
      for (const locale of ["en", "es"] as const) {
        const s = docCopy(locale, null)(k, PHONE);
        expect(s, `${k} (${locale})`).not.toContain("{");
        expect(s, `${k} (${locale})`).not.toMatch(/\b(a|de) el\b/);
        expect(s, `${k} (${locale})`).not.toMatch(/^(the|el) /);
      }
    }
  });

  it("a key with no {business} reads the same either way", () => {
    expect(docCopy("es", null)("customerDocs.upload")).toBe("Subir");
    expect(docCopy("en", null)("customerDocs.uploading", { percent: 45 })).toBe("Uploading 45 %");
  });
});
