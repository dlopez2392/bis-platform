import { describe, it, expect } from "vitest";
import { segmentsFor } from "./segments";

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
