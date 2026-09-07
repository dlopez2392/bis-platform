import { describe, it, expect } from "vitest";
import { laterOf } from "./anchor";

describe("laterOf — the instant an automation's clock runs from", () => {
  const ended = new Date("2026-09-08T22:00:00Z");

  it("is the meeting end when there is no stamp (a row flipped before 0026)", () => {
    expect(laterOf(ended, null)).toBe(ended);
  });

  it("is the stamp when the operator acted AFTER the meeting ended, the meeting end when they acted before it", () => {
    // Mutation: always return endsAt — the first assertion fails.
    const later = new Date("2026-09-09T12:30:00Z");
    const earlier = new Date("2026-09-08T21:00:00Z");
    expect(laterOf(ended, later)).toBe(later);
    expect(laterOf(ended, earlier)).toBe(ended);
  });

  it("falls back to the meeting end on a stamp it cannot read", () => {
    expect(laterOf(ended, new Date("nope"))).toBe(ended);
  });
});
