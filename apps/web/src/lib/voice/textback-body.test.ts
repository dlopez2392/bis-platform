import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultTextbackBody } from "./textback-body";

describe("defaultTextbackBody", () => {
  it("the default text-back is one GSM-7 segment", () => {
    const s = segmentsFor(defaultTextbackBody("Rio Roofing"));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
  });

  it("names the company, so an unknown-number text does not read as spam", () => {
    expect(defaultTextbackBody("Rio Roofing")).toContain("Rio Roofing");
  });

  // This is the guarantee the docstring above does NOT make: an accented
  // company name is common in this Rio Grande Valley platform's client base,
  // and it forces UCS-2 (70 chars/segment, not 160), pushing this message to
  // two segments. Pinned to the OBSERVED output, not a number picked in
  // advance — if a future copy edit changes this, this test is meant to move
  // and be re-verified, not silently keep passing.
  it("an accented company name forces UCS-2 and costs two segments, not one", () => {
    const s = segmentsFor(defaultTextbackBody("García Roofing"));
    expect(s.encoding).toBe("ucs2");
    expect(s.chars).toBe(84);
    expect(s.segments).toBe(2);
  });
});
