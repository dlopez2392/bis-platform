import { describe, it, expect } from "vitest";
import { normalizeFieldInput, EDITABLE_FIELDS, FIELD_TO_INPUT_KEY } from "./field-input";

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
  it("field allowlist is exactly the six standard columns (F-157 adds source)", () => {
    expect(EDITABLE_FIELDS).toEqual(["first_name", "last_name", "email", "phone", "company_name", "source"]);
  });
  // F-157: the drawer's Source line writes the owner's own note straight to
  // the column, with no shape rule (free text — "Referred by Jane", "Met at
  // the Expo") — same fallthrough first_name/last_name/company_name already
  // get. Mutation: give "source" its own branch that rejects something →
  // this still passes unless the branch is wrong, so the real proof is the
  // allowlist/map above plus updateContactFieldAction's own test wiring it
  // through to ContactInput.source.
  it("source trims and allows free text, like the other unshaped fields", () => {
    expect(normalizeFieldInput("source", "  Referred by Jane  ")).toEqual({ ok: true, value: "Referred by Jane" });
  });
  it("source maps to ContactInput's own key (mutation: map it to anything but \"source\" → FAILS)", () => {
    expect(FIELD_TO_INPUT_KEY.source).toBe("source");
  });
});
