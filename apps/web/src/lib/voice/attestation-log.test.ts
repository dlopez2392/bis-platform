import { describe, it, expect } from "vitest";
import { shownValue } from "./attestation-log";

describe("shownValue", () => {
  it("a plain value prints as itself", () => {
    expect(shownValue("TN-Validation-Passed")).toBe("TN-Validation-Passed");
  });
  it("a long run of digits (a phone number) is redacted, not printed", () => {
    expect(shownValue("9565550142123")).toBe("(redacted)");
  });
  it("a value with an unsafe character (log-forging) is unprintable", () => {
    expect(shownValue("a\nb")).toBe("(unprintable)");
  });
  it("a value past 64 characters is unprintable, even when every character is otherwise safe", () => {
    expect(shownValue("a".repeat(65))).toBe("(unprintable)");
  });
});
