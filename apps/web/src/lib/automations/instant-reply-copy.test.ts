import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultInstantReplyBody } from "./instant-reply-copy";

// The counts below are MEASURED, not chosen: if a run reports a different
// `chars`, pin the observed number (the textback-body.test.ts rule). The
// claims that must hold are the encoding and the segment count.

describe("defaultInstantReplyBody — English", () => {
  it("names the company and is ONE GSM-7 segment for a GSM-7 name", () => {
    const en = defaultInstantReplyBody("Rio Roofing", "en");
    expect(en).toBe("Hi, this is Rio Roofing. We got your message and will be in touch shortly. Reply here if you'd like to add anything.");
    const s = segmentsFor(en);
    expect(s.encoding).toBe("gsm7");
    expect(s.chars).toBe(116);
    expect(s.segments).toBe(1);
  });

  it("an accented company name flips the whole message to UCS-2 and costs TWO segments", () => {
    const s = segmentsFor(defaultInstantReplyBody("García Roofing", "en"));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(2);
  });

  it("a blank or whitespace-only name drops the opening clause instead of inventing one", () => {
    // Mutation: return the template with "" in place of the name → "Hi, this is ."
    const blank = defaultInstantReplyBody("", "en");
    expect(defaultInstantReplyBody("   ", "en")).toBe(blank);
    expect(blank).toBe("We got your message and will be in touch shortly. Reply here if you'd like to add anything.");
    expect(blank).not.toMatch(/\bour team\b/);
    expect(segmentsFor(blank)).toMatchObject({ encoding: "gsm7", segments: 1 });
  });

  it("a company name containing $ patterns is inserted literally", () => {
    // Mutation: plain-string replace → "$&" expands to "{name}".
    expect(defaultInstantReplyBody("Cash $& Carry", "en")).toContain("Cash $& Carry");
    expect(defaultInstantReplyBody("A$'B", "es")).toContain("A$'B");
  });
});

describe("defaultInstantReplyBody — Spanish", () => {
  it("answers a Spanish submission in Spanish, tú form like the receipt email, naming the company", () => {
    const es = defaultInstantReplyBody("Rio Roofing", "es");
    expect(es).toBe("Hola, somos Rio Roofing. Recibimos tu mensaje y nos pondremos en contacto pronto. Responde a este mensaje si quieres agregar algo.");
    expect(es).not.toBe(defaultInstantReplyBody("Rio Roofing", "en"));
  });

  it("costs ONE segment — no á/í/ó/ú anywhere in the Spanish copy, deliberately", () => {
    // Mutation: write "aquí" into the Spanish default → ucs2, 2 segments.
    const s = segmentsFor(defaultInstantReplyBody("Rio Roofing", "es"));
    expect(s.encoding).toBe("gsm7");
    expect(s.chars).toBe(130);
    expect(s.segments).toBe(1);
    expect(defaultInstantReplyBody("", "es")).not.toMatch(/[áíóú]/);
  });

  it("the blank-name variant stands alone as a sentence and stays one segment", () => {
    const blank = defaultInstantReplyBody("", "es");
    expect(blank).toBe("Recibimos tu mensaje y nos pondremos en contacto pronto. Responde a este mensaje si quieres agregar algo.");
    expect(segmentsFor(blank)).toMatchObject({ encoding: "gsm7", segments: 1 });
  });
});

describe("no em dash in any default — it is outside GSM-7 and would double every text", () => {
  it("all four variants", () => {
    for (const [name, lang] of [["Rio Roofing", "en"], ["", "en"], ["Rio Roofing", "es"], ["", "es"]] as const) {
      expect(defaultInstantReplyBody(name, lang)).not.toContain("—");
    }
  });
});
