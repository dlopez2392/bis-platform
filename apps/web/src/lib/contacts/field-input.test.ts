import { describe, it, expect } from "vitest";
import { normalizeFieldInput, EDITABLE_FIELDS } from "./field-input";

describe("normalizeFieldInput", () => {
  it("trims, allows empty (clears the field)", () => {
    expect(normalizeFieldInput("first_name", "  Maria ")).toEqual({ ok: true, value: "Maria" });
    expect(normalizeFieldInput("email", "   ")).toEqual({ ok: true, value: "" });
  });
  it("rejects a mangled email but accepts a real one", () => {
    expect(normalizeFieldInput("email", "not-an-email").ok).toBe(false);
    expect(normalizeFieldInput("email", "a@b.co").ok).toBe(true);
  });
  it("rejects letters in phone, accepts formatted numbers", () => {
    expect(normalizeFieldInput("phone", "call me").ok).toBe(false);
    expect(normalizeFieldInput("phone", "+1 (956) 555-0100").ok).toBe(true);
  });
  it("field allowlist is exactly the five standard columns", () => {
    expect(EDITABLE_FIELDS).toEqual(["first_name", "last_name", "email", "phone", "company_name"]);
  });
});
