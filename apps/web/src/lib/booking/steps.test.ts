import { describe, it, expect } from "vitest";
import { bookingStep, BOOKING_STEP_COUNT } from "./steps";

describe("bookingStep", () => {
  it("starts at pick-a-time", () => {
    expect(bookingStep({ selectedSlot: null, succeeded: false })).toBe(1);
  });

  it("advances to your-details once a slot is chosen", () => {
    expect(bookingStep({ selectedSlot: "2026-09-04T15:00:00Z", succeeded: false })).toBe(2);
  });

  it("shows confirmed once the booking succeeded", () => {
    expect(bookingStep({ selectedSlot: "2026-09-04T15:00:00Z", succeeded: true })).toBe(3);
  });

  it("treats success as final even with a slot still held", () => {
    // The ordering that matters: checking the slot first would claim step 2
    // on a booking the visitor has already completed.
    expect(bookingStep({ selectedSlot: "2026-09-04T15:00:00Z", succeeded: true })).toBe(3);
    expect(bookingStep({ selectedSlot: null, succeeded: true })).toBe(3);
  });

  it("never returns a step outside the rendered range", () => {
    for (const selectedSlot of [null, "2026-09-04T15:00:00Z"]) {
      for (const succeeded of [true, false]) {
        const step = bookingStep({ selectedSlot, succeeded });
        expect(step).toBeGreaterThanOrEqual(1);
        expect(step).toBeLessThanOrEqual(BOOKING_STEP_COUNT);
      }
    }
  });
});
