import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultTextbackBody } from "./textback-body";

describe("defaultTextbackBody", () => {
  it("the default text-back is one GSM-7 segment", () => {
    const s = segmentsFor(defaultTextbackBody("Rio Roofing", "en"));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
  });

  it("names the company, so an unknown-number text does not read as spam", () => {
    expect(defaultTextbackBody("Rio Roofing", "en")).toContain("Rio Roofing");
  });

  // This is the guarantee the docstring above does NOT make: an accented
  // company name is common in this Rio Grande Valley platform's client base,
  // and it forces UCS-2 (70 chars/segment, not 160), pushing this message to
  // two segments. Pinned to the OBSERVED output, not a number picked in
  // advance — if a future copy edit changes this, this test is meant to move
  // and be re-verified, not silently keep passing.
  it("an accented company name forces UCS-2 and costs two segments, not one", () => {
    const s = segmentsFor(defaultTextbackBody("García Roofing", "en"));
    expect(s.encoding).toBe("ucs2");
    expect(s.chars).toBe(84);
    expect(s.segments).toBe(2);
  });

  // A blank account name must not fall back to an invented placeholder noun
  // ("our team") — that reads like a machine wrote it. The identifying
  // clause is dropped entirely and the message opens on the apology alone,
  // which is why there is no stray "is ." fragment left behind. Both a
  // wholly empty string and a whitespace-only one take this branch, since
  // an operator's stored name could plausibly be either.
  it("a blank or whitespace-only name drops the identifying clause instead of inventing one", () => {
    const blank = defaultTextbackBody("", "en");
    const whitespace = defaultTextbackBody("   ", "en");
    expect(blank).toBe(whitespace);
    expect(blank).not.toContain("is .");
    expect(blank).not.toMatch(/\bour team\b/);
    expect(blank).toBe("Sorry we missed you just now, reply here and we'll help.");

    const s = segmentsFor(blank);
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
  });

  // A company name is arbitrary operator input. `$&` and `$'` are
  // substitution patterns to String.replace, and a plain-string replacement
  // would expand them into fragments of the template itself.
  it("a company name containing $ patterns is inserted literally", () => {
    expect(defaultTextbackBody("Cash $& Carry", "en")).toContain("Cash $& Carry");
    expect(defaultTextbackBody("A$'B", "es")).toContain("A$'B");
  });
});

describe("defaultTextbackBody — Spanish", () => {
  it("answers a Spanish caller in Spanish, not English", () => {
    const es = defaultTextbackBody("Rio Roofing", "es");
    expect(es).toContain("Rio Roofing");
    expect(es).toContain("No pudimos contestar");
    expect(es).not.toBe(defaultTextbackBody("Rio Roofing", "en"));
    expect(es).not.toContain("Sorry");
  });

  /**
   * The measured constraint, not an assumption: á/í/ó/ú are outside GSM7_BASE
   * (é/ñ/ü/¿/¡ are inside it), so ONE of them drops the whole message to UCS-2
   * at 70 characters per segment — which this sentence does not fit in. The
   * natural first draft, "...responda aquí y le ayudamos", measured
   * ucs2/86 chars/2 segments for a plain GSM-7 company name: two segments for
   * every Spanish caller, forever, on the client's own A2P registration. The
   * shipped wording says the same thing in one.
   */
  it("costs ONE segment — the Spanish copy stays inside GSM-7 deliberately", () => {
    const s = segmentsFor(defaultTextbackBody("Rio Roofing", "es"));
    expect(s.encoding).toBe("gsm7");
    expect(s.chars).toBe(94);
    expect(s.segments).toBe(1);
  });

  it("the accented-name case behaves exactly as the English one does", () => {
    // Same trap, same measured cost: the NAME is what flips the encoding here,
    // not the copy.
    const s = segmentsFor(defaultTextbackBody("García Roofing", "es"));
    expect(s.encoding).toBe("ucs2");
    expect(s.chars).toBe(97);
    expect(s.segments).toBe(2);
  });

  it("a blank name drops the identifying clause in Spanish too, still one segment", () => {
    const blank = defaultTextbackBody("", "es");
    expect(blank).toBe(defaultTextbackBody("   ", "es"));
    expect(blank).toBe("No pudimos contestar su llamada, responda este mensaje y le ayudamos.");
    expect(blank).not.toContain("somos .");
    const s = segmentsFor(blank);
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
  });

  /**
   * The rule behind the copy, stated as a check rather than a comment: if a
   * future edit reaches for the natural accent, this fails here instead of on
   * the invoice.
   */
  it("carries no character that would flip the message to UCS-2 on its own", () => {
    for (const body of [defaultTextbackBody("Rio Roofing", "es"), defaultTextbackBody("", "es")]) {
      expect(body).not.toMatch(/[áíóú]/);
      expect(segmentsFor(body).encoding).toBe("gsm7");
    }
  });
});
