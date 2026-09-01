import { describe, expect, it } from "vitest";
import { accountInitial } from "./account-initial";

describe("accountInitial", () => {
  it("uppercases the first character of a normal name", () => {
    expect(accountInitial("Rio Roofing")).toBe("R");
  });

  it("uppercases a lowercase name", () => {
    expect(accountInitial("acme corp")).toBe("A");
  });

  it("trims leading whitespace before taking the first character", () => {
    expect(accountInitial("  Acme")).toBe("A");
  });

  it("returns empty string for an empty name", () => {
    expect(accountInitial("")).toBe("");
  });

  it("returns empty string for a whitespace-only name", () => {
    expect(accountInitial("   ")).toBe("");
  });

  it("takes a whole surrogate-pair character rather than splitting it", () => {
    expect(accountInitial("😀 Emoji Co")).toBe("😀");
  });
});
