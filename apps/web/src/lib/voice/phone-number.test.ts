import { describe, it, expect } from "vitest";
import { toE164 } from "./phone-number";

describe("toE164", () => {
  it.each([
    ["9562921696", "+19562921696"],
    ["(956) 292-1696", "+19562921696"],
    ["19562921696", "+19562921696"],
    ["+19562921696", "+19562921696"],
    ["525512345678", "+525512345678"],
  ])("%s → %s", (raw, want) => expect(toE164(raw)).toBe(want));
  it.each([["", null], ["12345", null], [null, null], [undefined, null],
    ["12345678901234567890", null]])("invalid %s → null", (raw, want) =>
    expect(toE164(raw)).toBe(want));
});
