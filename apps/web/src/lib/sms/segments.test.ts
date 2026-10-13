import { describe, it, expect } from "vitest";
import { segmentsFor, gsmFoldVowels, accentCost } from "./segments";
import { formatWhen } from "@/lib/booking/time";

describe("segmentsFor", () => {
  it("counts GSM-7 at 160 per segment", () => {
    expect(segmentsFor("a".repeat(160))).toEqual({ encoding: "gsm7", chars: 160, segments: 1 });
    // Over one segment, GSM-7 concatenation uses 153 per part, not 160.
    expect(segmentsFor("a".repeat(161)).segments).toBe(2);
  });

  it("drops the WHOLE message to UCS-2 at 70 for one non-GSM character", () => {
    // The defect this exists to prevent: this platform is bilingual, and a
    // single curly apostrophe or an accent outside GSM-7 more than halves
    // capacity while a naive character count still reads "fine".
    const curly = "a".repeat(80) + "’"; // right single quote, NOT in GSM-7
    expect(segmentsFor(curly).encoding).toBe("ucs2");
    expect(segmentsFor(curly).segments).toBe(2);
    expect(segmentsFor("a".repeat(70)).segments).toBe(1);
  });

  it("keeps Spanish that IS representable in GSM-7 on the cheap encoding", () => {
    // á í ó ú are NOT in GSM-7; ñ, é and ü ARE. Asserting both directions so
    // the charset table cannot be quietly emptied and still pass.
    expect(segmentsFor("mañana señor").encoding).toBe("gsm7");
    expect(segmentsFor("café").encoding).toBe("gsm7");
    expect(segmentsFor("adiós").encoding).toBe("ucs2");
  });

  it("counts a GSM-7 extension character as two", () => {
    // { } [ ] ~ ^ \ | € occupy two septets each.
    expect(segmentsFor("{".repeat(80)).chars).toBe(160);
    expect(segmentsFor("{".repeat(81)).segments).toBe(2);
  });

  it("an empty body is one segment, not zero", () => {
    expect(segmentsFor("")).toEqual({ encoding: "gsm7", chars: 0, segments: 1 });
  });
});

describe("Spanish texts stay one alphabet (spec §13, C19)", () => {
  it("folds exactly the four vowels outside GSM-7 and their capitals; é, ñ, ü, ¿, ¡ stay (mutation: also fold é -> FAILS)", () => {
    expect(gsmFoldVowels("sáb ÁÍÓÚ íóú é ñ ü ¿¡")).toBe("sab AIOU iou é ñ ü ¿¡");
  });
  it("a Saturday in Spanish is GSM-7 once folded (mutation: return text unchanged -> FAILS)", () => {
    const sat = formatWhen(new Date("2026-10-17T14:30:00Z"), "America/Chicago", "es");
    expect(segmentsFor(sat).encoding).toBe("ucs2");
    expect(segmentsFor(gsmFoldVowels(sat)).encoding).toBe("gsm7");
  });
  it("accentCost: the parts with the accents and without; null when there are none (mutation: count the unfolded text twice -> FAILS)", () => {
    const long = "Gracias por su visita, aquí estamos para lo que necesite. ".repeat(2);
    expect(accentCost(long)).toEqual({ parts: segmentsFor(long).segments, foldedParts: segmentsFor(gsmFoldVowels(long)).segments });
    expect(accentCost(long)!.parts).toBeGreaterThan(accentCost(long)!.foldedParts);
    expect(accentCost("Hola, sin acentos.")).toBeNull();
  });
});
