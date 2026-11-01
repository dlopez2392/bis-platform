import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
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
  it("company_name stays editable (trimmed) but has no ContactInput key: it is a group now", () => {
    expect(EDITABLE_FIELDS).toContain("company_name");
    expect("company_name" in FIELD_TO_INPUT_KEY).toBe(false);
  });

  // S-10 T3: the inline-edited email/phone shape refusal (shown directly by inline-field.tsx's
  // toast, unlike the Add contact dialog's own fixed errorKey) now reads the reader's language —
  // the SAME two catalogue sentences contacts.add.badEmail/badPhone already carry (2026-10-28).
  describe("in the reader's language (S-10 T3)", () => {
    it("the email refusal is said in Spanish when the caller passes es (mutation: read the raw English literal -> FAILS)", () => {
      expect(normalizeFieldInput("email", "not-an-email", "es")).toEqual({ ok: false, error: m["contacts.add.badEmail.es"] });
    });
    it("the phone refusal is said in Spanish too", () => {
      expect(normalizeFieldInput("phone", "call me", "es")).toEqual({ ok: false, error: m["contacts.add.badPhone.es"] });
    });
    it("defaults to English when no locale is passed", () => {
      expect(normalizeFieldInput("email", "not-an-email")).toEqual({ ok: false, error: m["contacts.add.badEmail"] });
    });
  });
});
