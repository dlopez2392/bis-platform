import { describe, it, expect } from "vitest";
import { validateEnumValue } from "./inline-field";

describe("validateEnumValue", () => {
  it("accepts a listed value, rejects anything else (mutation: drop the .some check and always return ok:true → FAILS the second assertion)", () => {
    const options = [{ value: "en", label: "English" }, { value: "es", label: "Español" }];
    expect(validateEnumValue(options, "es")).toEqual({ ok: true, value: "es" });
    expect(validateEnumValue(options, "fr").ok).toBe(false);
  });
});
