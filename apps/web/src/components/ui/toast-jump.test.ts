import { describe, expect, it } from "vitest";
import { matchesToastJumpHotkey, isEscapeKey } from "./toast-jump";

describe("matchesToastJumpHotkey", () => {
  it("is true for Alt+T — sonner's own default hotkey (sonner/dist/index.mjs:918-920)", () => {
    expect(matchesToastJumpHotkey({ altKey: true, code: "KeyT" })).toBe(true);
  });
  it("is false without Alt held", () => {
    expect(matchesToastJumpHotkey({ altKey: false, code: "KeyT" })).toBe(false);
  });
  it("is false for a different key with Alt held", () => {
    expect(matchesToastJumpHotkey({ altKey: true, code: "KeyS" })).toBe(false);
  });
});

describe("isEscapeKey", () => {
  it("is true for Escape", () => {
    expect(isEscapeKey({ key: "Escape" })).toBe(true);
  });
  it("is false for any other key", () => {
    expect(isEscapeKey({ key: "Enter" })).toBe(false);
  });
});
