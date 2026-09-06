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
});
