import { describe, it, expect } from "vitest";
import {
  emptyCallState, classifyOutcome, withBooking, withBookingCancelled,
  withLead, withMessage, withTranscript, withServed, wasServed, withTransferred,
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

describe("served", () => {
  it("a fresh call has served nobody", () => {
    expect(wasServed(emptyCallState())).toBe(false);
    expect(emptyCallState().served).toEqual([]);
  });

  it("records each action once — two lookups in one call are still one served caller", () => {
    let s = withServed(emptyCallState(), "booking_found");
    s = withServed(s, "booking_found");
    expect(s.served).toEqual(["booking_found"]);
    s = withServed(s, "cancelled");
    expect(s.served).toEqual(["booking_found", "cancelled"]);
    expect(wasServed(s)).toBe(true);
  });

  /**
   * The constraint the fix was written under: `abandoned` feeds the calls
   * list, the outcome pill and the dashboard KPIs, so serving a caller must
   * NOT change what the row says. If someone later "simplifies" this by
   * teaching classifyOutcome about `served`, this fails.
   */
  it("does NOT change what classifyOutcome says about the call", () => {
    const spoke = withTranscript(emptyCallState(), { role: "caller", text: "hola", at: "t" });
    expect(classifyOutcome(spoke)).toBe("abandoned");
    expect(classifyOutcome(withServed(spoke, "cancelled"))).toBe("abandoned");
    expect(classifyOutcome(withServed(spoke, "booking_found"))).toBe("abandoned");
    // And a silent call stays spam even if a tool somehow ran.
    expect(classifyOutcome(withServed(emptyCallState(), "cancelled"))).toBe("spam");
  });

  /**
   * The actual defect, at the state layer: a caller cancelling a booking made
   * on a PREVIOUS call has nothing in `state.bookings` for
   * `withBookingCancelled` to map over, so the cancellation leaves no trace
   * there at all. `served` is the only thing that remembers it.
   */
  it("a cancellation from a previous call leaves no booking trace, only the served flag", () => {
    const spoke = withTranscript(emptyCallState(), { role: "caller", text: "quiero cancelar", at: "t" });
    const cancelled = withServed(withBookingCancelled(spoke, "booking-from-last-week"), "cancelled");
    expect(cancelled.bookings).toEqual([]);
    expect(classifyOutcome(cancelled)).toBe("abandoned");
    expect(wasServed(cancelled)).toBe(true);
  });

  it("withTransferred writes the marker the text-back gate and the summary both read", () => {
    // Scope note: this asserts only that the wrapper writes the entry — it
    // restates one line of production and cannot detect the failure the
    // marker EXISTS to prevent. The behaviour guard is
    // finish-call.test.ts's "does NOT text a caller we put THROUGH TO A
    // PERSON", which goes red when `wasServed` stops counting "transferred";
    // this one stays green through that mutation.
    const s = withTransferred(emptyCallState());
    expect(s.served).toContain("transferred");
  });
  it("withTransferred is idempotent — served is append-only and deduplicated", () => {
    const s = withTransferred(withTransferred(emptyCallState()));
    expect(s.served.filter((a) => a === "transferred")).toHaveLength(1);
  });
  it("a transferred call still classifies abandoned at socket close — nobody has reached a human YET", () => {
    // The result route upgrades the row to `transferred` only on
    // DialCallStatus: completed. At socket close that is not yet known, and
    // claiming it would be a lie on a call that rings out.
    const s = withTransferred(withTranscript(emptyCallState(), {
      role: "caller", text: "can I speak to someone", at: new Date().toISOString(),
    }));
    expect(classifyOutcome(s)).toBe("abandoned");
  });
});
