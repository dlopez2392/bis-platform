import { describe, it, expect } from "vitest";
import { isCalendarLive } from "./data";

describe("isCalendarLive", () => {
  it("is live only when enabled", () => {
    expect(isCalendarLive({ enabled: true })).toBe(true);
    // MUTATION: `return true;` unconditionally -- this FAILS.
    expect(isCalendarLive({ enabled: false })).toBe(false);
  });
});
