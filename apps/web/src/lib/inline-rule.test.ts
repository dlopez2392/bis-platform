import { describe, it, expect } from "vitest";
import { validateInlineRule, cleanEdgeSpace, codePoints } from "./inline-rule";
import { m } from "@/lib/messages";

/** 0070's measurement of PG's [:space:] (0070 migration header; 0071 reuses the class). */
const MEASURED = [
  ...Array.from({ length: 5 }, (_, i) => 0x09 + i), ...Array.from({ length: 4 }, (_, i) => 0x1c + i), 0x20, 0x85, 0xa0, 0x1680,
  ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
].map((cp) => String.fromCodePoint(cp));

describe("cleanEdgeSpace", () => {
  it("strips every code point of the database's measured class at both edges, and keeps it inside (mutation: drop 0x85 from EXTRA -> FAILS)", () => {
    for (const ch of MEASURED) {
      expect(cleanEdgeSpace(`${ch}Ana${ch}`), `U+${ch.codePointAt(0)!.toString(16)}`).toBe("Ana");
      expect(cleanEdgeSpace(`A${ch}B`)).toBe(`A${ch}B`);
    }
    expect(cleanEdgeSpace(String.fromCodePoint(0x200b, 0xfeff) + "Ana")).toBe("Ana"); // zero-width space and BOM: stripped too (a superset is safe)
  });
});

describe("validateInlineRule: text", () => {
  const rule = { kind: "text" as const, max: 5, required: false };
  it("counts code points as char_length does, and refuses one past the limit in the reader's language", () => {
    expect(codePoints("🏠🏠🏠")).toBe(3);
    expect(validateInlineRule(rule, " 🏠abcd ")).toEqual({ ok: true, value: "🏠abcd" });
    expect(validateInlineRule(rule, "abcdef")).toEqual({ ok: false, error: m["inline.rule.tooLong"].replace("{max}", "5") });
    expect(validateInlineRule(rule, "abcdef", "es")).toEqual({ ok: false, error: m["inline.rule.tooLong.es"].replace("{max}", "5") });
  });
  it("blank clears an optional field and is refused for a required one (mutation: ignore required -> FAILS)", () => {
    expect(validateInlineRule(rule, "   ")).toEqual({ ok: true, value: "" });
    expect(validateInlineRule({ ...rule, required: true }, "   ")).toEqual({ ok: false, error: m["inline.rule.required"] });
  });
});

describe("validateInlineRule: date", () => {
  it("takes a real YYYY-MM-DD, refuses 2026-02-30 and a date after notAfter, the boundary day allowed (mutation: compare with >= -> FAILS)", () => {
    const rule = { kind: "date" as const, required: false, notAfter: "2026-10-11" };
    expect(validateInlineRule(rule, "2026-10-11")).toEqual({ ok: true, value: "2026-10-11" });
    expect(validateInlineRule(rule, "2026-02-30")).toEqual({ ok: false, error: m["inline.rule.badDate"] });
    expect(validateInlineRule(rule, "2026-10-12")).toEqual({ ok: false, error: m["inline.rule.future"] });
    expect(validateInlineRule(rule, "")).toEqual({ ok: true, value: "" });
    expect(validateInlineRule({ ...rule, required: true }, "")).toEqual({ ok: false, error: m["inline.rule.required"] });
  });
});
