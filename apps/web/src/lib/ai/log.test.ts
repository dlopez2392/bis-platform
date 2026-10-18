import { describe, it, expect } from "vitest";
import { aiSafeError, errorName } from "./log";

describe("logging an error that may carry a model's words (plan deviation 6)", () => {
  it("a SyntaxError is named, never quoted: JSON.parse echoes its input (mutation: return loggableError(e) for every error -> FAILS)", () => {
    let caught: unknown;
    try { JSON.parse("SENTINEL-OUTPUT-7f3 not json"); } catch (e) { caught = e; }
    expect(aiSafeError(caught)).toBe("SyntaxError (an answer that did not parse)");
  });
  it("any other error keeps loggableError's form", () => {
    expect(aiSafeError(new Error("insert failed: duplicate key"))).toBe("Error: insert failed: duplicate key");
  });
  it("errorName names the class only (mutation: return String(e) -> FAILS)", () => {
    expect([errorName(new TypeError("SENTINEL-PROMPT-7f3")), errorName("x"), errorName(null)]).toEqual(["TypeError", "string", "object"]);
  });
});
