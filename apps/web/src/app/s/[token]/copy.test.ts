import { describe, it, expect } from "vitest";
import { m, type MessageKey } from "@/lib/messages";
import { shareCopy } from "./copy";

const PHONE = { phone: "(956) 555-0123" };

describe("shareCopy: the shared file page's words, with a brand name or without one", () => {
  it("with a brand name: the {business} sentence, filled, in both languages", () => {
    expect(shareCopy("en", "Casa Verde")("customerDocs.call", PHONE)).toBe("Questions? Call Casa Verde at (956) 555-0123.");
    expect(shareCopy("es", "Casa Verde")("sharePage.heading")).toBe("Casa Verde compartió un archivo con usted");
  });

  it.each<[MessageKey, string, string]>([
    ["sharePage.pageTitle", "A shared file", "Un archivo compartido"],
    ["sharePage.heading", "A file was shared with you", "Se compartió un archivo con usted"],
    ["sharePage.ask", "Ask the business that sent it to send it again.", "Pida al negocio que se lo envió que lo mande de nuevo."],
    ["customerDocs.call", "Questions? Call the business at (956) 555-0123.", "¿Preguntas? Llame al negocio al (956) 555-0123."],
    ["customerDocs.callNoPhone", "Questions? Contact the business.", "¿Preguntas? Comuníquese con el negocio."],
  ])("no brand name: %s reads its own sentence (mutation: drop its NO_NAME line → FAILS)", (key, en, es) => {
    expect(shareCopy("en", null)(key, PHONE)).toBe(en);
    expect(shareCopy("es", null)(key, PHONE)).toBe(es);
  });

  it("EVERY sharePage key that names {business} has a no-name sentence, in both languages (a key added later without one → FAILS here)", () => {
    const named = (Object.keys(m) as MessageKey[]).filter((k) => k.startsWith("sharePage.") && !k.endsWith(".es")
      && (m[k].includes("{business}") || (m[`${k}.es` as MessageKey] ?? "").includes("{business}")));
    expect(named.sort()).toEqual(["sharePage.ask", "sharePage.heading", "sharePage.pageTitle"]);
    for (const k of named) {
      for (const locale of ["en", "es"] as const) {
        const s = shareCopy(locale, null)(k, PHONE);
        expect(s, `${k} (${locale})`).not.toContain("{");
        expect(s, `${k} (${locale})`).not.toMatch(/\b(a|de) el\b/);
        expect(s, `${k} (${locale})`).not.toMatch(/^(the|el) /);
      }
    }
  });

  it("a key with no {business} reads the same either way", () => {
    expect(shareCopy("es", null)("sharePage.download")).toBe("Descargar");
    expect(shareCopy("en", "Casa Verde")("sharePage.details", { type: "PDF", size: "1.2 MB" })).toBe("PDF file · 1.2 MB");
  });
});
