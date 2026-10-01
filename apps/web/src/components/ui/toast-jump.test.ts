import { describe, expect, it } from "vitest";
import {
  TOAST_JUMP_HOTKEY,
  TOAST_JUMP_HOTKEY_LABEL,
  matchesToastJumpHotkey,
  isEscapeKey,
} from "./toast-jump";

describe("TOAST_JUMP_HOTKEY_LABEL", () => {
  it("reads 'Alt+T' for the default ['altKey','KeyT'] — sonner's own default (sonner/dist/index.mjs:918-920)", () => {
    expect(TOAST_JUMP_HOTKEY).toEqual(["altKey", "KeyT"]);
    expect(TOAST_JUMP_HOTKEY_LABEL).toBe("Alt+T");
  });
});

describe("matchesToastJumpHotkey", () => {
  it("is true for Alt+T", () => {
    expect(matchesToastJumpHotkey({ altKey: true, code: "KeyT" })).toBe(true);
  });
  it("is false without Alt held", () => {
    expect(matchesToastJumpHotkey({ altKey: false, code: "KeyT" })).toBe(false);
  });
  it("is false for a different key with Alt held", () => {
    expect(matchesToastJumpHotkey({ altKey: true, code: "KeyS" })).toBe(false);
  });
  it("is false when altKey is simply absent from the event", () => {
    expect(matchesToastJumpHotkey({ code: "KeyT" })).toBe(false);
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
