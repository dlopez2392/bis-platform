import { describe, it, expect } from "vitest";
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
  it("preserves mode and radius the editor does not manage", () => {
    const stored = { mode: "dark" as const, radius: "1rem", accent: "#111111", transparentBackground: true };
    const merged = mergeFormTheme(stored, { accent: "#222222", transparentBackground: false });
    expect(merged).toEqual({ mode: "dark", radius: "1rem", accent: "#222222", transparentBackground: false });
  });

  it("defaults to nothing extra when no theme was ever stored", () => {
    const merged = mergeFormTheme(undefined, { accent: "#6d28d9", transparentBackground: false });
    expect(merged).toEqual({ accent: "#6d28d9", transparentBackground: false });
  });

  it("clears accent when the edit supplies undefined", () => {
    const stored = { mode: "dark" as const, accent: "#111111", transparentBackground: false };
    const merged = mergeFormTheme(stored, { accent: undefined, transparentBackground: false });
    expect(merged.accent).toBeUndefined();
    expect(merged.mode).toBe("dark");
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
