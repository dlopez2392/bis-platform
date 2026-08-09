import { describe, it, expect } from "vitest";
import type { FormTheme } from "@bis/db";
import { defaultFieldKey, mergeFormTheme, isValidFormFieldList } from "./editor-helpers";

describe("defaultFieldKey", () => {
  it("strips the core. prefix", () => {
    expect(defaultFieldKey("core.email")).toBe("email");
    expect(defaultFieldKey("core.first_name")).toBe("first_name");
  });

  it("namespaces custom fields so they can never collide with a core key", () => {
    expect(defaultFieldKey("custom.email")).toBe("custom_email");
  });

  it("leaves kinds with no prefix alone", () => {
    expect(defaultFieldKey("message")).toBe("message");
    expect(defaultFieldKey("consent")).toBe("consent");
  });
});

describe("mergeFormTheme", () => {
  it("keeps keys the editor does not manage", () => {
    const stored = { mode: "dark" as const, radius: "1rem", transparentBackground: true };
    const merged = mergeFormTheme(stored, { transparentBackground: false });
    expect(merged).toEqual({ mode: "dark", radius: "1rem", transparentBackground: false });
  });

  it("handles an absent stored theme", () => {
    const merged = mergeFormTheme(undefined, { transparentBackground: false });
    expect(merged).toEqual({ transparentBackground: false });
  });

  // A form saved before the brand color replaced per-form accents keeps its
  // stored accent key untouched. Nothing reads it; no migration rewrites it.
  it("leaves a legacy accent key in place without reading it", () => {
    const stored = { accent: "#111111", transparentBackground: false } as FormTheme;
    const merged = mergeFormTheme(stored, { transparentBackground: true });
    expect((merged as Record<string, unknown>).accent).toBe("#111111");
  });
});

describe("isValidFormFieldList", () => {
  const valid = { key: "email", kind: "core.email", label: "Email", required: true };

  it("accepts a well-formed array", () => {
    expect(isValidFormFieldList([valid])).toBe(true);
    expect(isValidFormFieldList([])).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(isValidFormFieldList({ ...valid })).toBe(false);
    expect(isValidFormFieldList(null)).toBe(false);
  });

  it("rejects an item missing required shape, e.g. a tampered [{}]", () => {
    expect(isValidFormFieldList([{}])).toBe(false);
    expect(isValidFormFieldList([{ ...valid, key: "" }])).toBe(false);
    expect(isValidFormFieldList([{ ...valid, required: "true" }])).toBe(false);
    expect(isValidFormFieldList([{ ...valid, kind: 5 }])).toBe(false);
    expect(isValidFormFieldList([valid, {}])).toBe(false);
  });
});
