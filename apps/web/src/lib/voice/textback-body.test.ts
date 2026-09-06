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

  // A blank account name must not fall back to an invented placeholder noun
  // ("our team") — that reads like a machine wrote it. The identifying
  // clause is dropped entirely and the message opens on the apology alone,
  // which is why there is no stray "is ." fragment left behind. Both a
  // wholly empty string and a whitespace-only one take this branch, since
  // an operator's stored name could plausibly be either.
  it("a blank or whitespace-only name drops the identifying clause instead of inventing one", () => {
    const blank = defaultTextbackBody("");
    const whitespace = defaultTextbackBody("   ");
    expect(blank).toBe(whitespace);
    expect(blank).not.toContain("is .");
    expect(blank).not.toMatch(/\bour team\b/);
    expect(blank).toBe("Sorry we missed you just now, reply here and we'll help.");

    const s = segmentsFor(blank);
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
  });
});
