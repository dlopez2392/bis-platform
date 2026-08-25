import { describe, it, expect } from "vitest";
import {
  emptyCallState, classifyOutcome, withBooking, withBookingCancelled,
  withLead, withMessage, withTranscript,
} from "./call-state";

describe("classifyOutcome priority", () => {
  it("booked > lead > message > abandoned > spam", () => {
    let s = emptyCallState();
    expect(classifyOutcome(s)).toBe("spam");
    s = withTranscript(s, { role: "caller", text: "hello?", at: "t" });
    expect(classifyOutcome(s)).toBe("abandoned");
    s = withMessage(s, { body: "call me", at: "t" });
    expect(classifyOutcome(s)).toBe("message");
    s = withLead(s, { fields: { fullName: "Ana" } });
    expect(classifyOutcome(s)).toBe("lead");
    s = withBooking(s, { id: "b1", contactName: "Ana", startsAt: "2027-01-01T15:00:00Z", endsAt: "2027-01-01T16:00:00Z" });
    expect(classifyOutcome(s)).toBe("booked");
    expect(classifyOutcome(withBookingCancelled(s, "b1"))).toBe("lead"); // cancelled booking no longer counts
  });
  it("assistant-only transcript is still spam (caller never spoke)", () => {
    const s = withTranscript(emptyCallState(), { role: "assistant", text: "Thanks for calling", at: "t" });
    expect(classifyOutcome(s)).toBe("spam");
  });
  it("withBooking replaces a re-used id instead of duplicating", () => {
    let s = withBooking(emptyCallState(), { id: "b1", contactName: "A", startsAt: "x", endsAt: "y" });
    s = withBooking(s, { id: "b1", contactName: "A", startsAt: "z", endsAt: "w" });
    expect(s.bookings).toHaveLength(1);
    expect(s.bookings[0]!.startsAt).toBe("z");
  });
});
