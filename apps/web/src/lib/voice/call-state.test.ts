import { describe, it, expect } from "vitest";
import {
  emptyCallState, classifyOutcome, withBooking, withBookingCancelled,
  withLead, withMessage, withTranscript, withServed, wasServed, withTransferred,
  withRecordedCaller, withCallerDelta, clearPendingCallerTurn, callerSpoke,
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
  it("a RECORDING that talked is spam, not abandoned", () => {
    // 2026-09-17: eight scam robocalls reached the only real client on the
    // platform, and every one landed on the `abandoned` branch below —
    // because a robot's monologue IS a caller turn with text. The owner's
    // dashboard told him he had lost eight customers in a day.
    //
    // `abandoned` means a person called and we did not serve them. A
    // recording is not a person, and the distinction is what the whole Calls
    // list and the weekly report's "calls answered" number rest on.
    const s = withRecordedCaller(
      withTranscript(emptyCallState(), { role: "caller", text: "press 9 to opt out", at: "t" }),
    );
    expect(classifyOutcome(s)).toBe("spam");
  });

  it("but a recording that BOOKED is still booked — the marker never outranks real work", () => {
    // Defensive, and cheap. If the guard ever misfires on a real caller, the
    // thing that caller actually DID must survive it: an appointment on the
    // calendar cannot be re-labelled spam by a content heuristic. The marker
    // belongs below every branch that represents work.
    let s = withRecordedCaller(
      withTranscript(emptyCallState(), { role: "caller", text: "press 9 to opt out", at: "t" }),
    );
    s = withBooking(s, { id: "b1", contactName: "Ana", startsAt: "x", endsAt: "y" });
    expect(classifyOutcome(s)).toBe("booked");
    expect(classifyOutcome(withLead(withRecordedCaller(emptyCallState()), { fields: {} }))).toBe("lead");
    expect(classifyOutcome(withMessage(withRecordedCaller(emptyCallState()), { body: "x", at: "t" }))).toBe("message");
  });

  it("withRecordedCaller is idempotent and leaves the transcript alone", () => {
    const base = withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" });
    const once = withRecordedCaller(base);
    const twice = withRecordedCaller(once);
    expect(twice.recordedCaller).toBe(true);
    expect(twice.transcript).toEqual(base.transcript);
  });

  it("an ordinary call is not marked, so the flag cannot be read as a default", () => {
    expect(emptyCallState().recordedCaller).toBe(false);
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

describe("pendingCallerTurn — the growing prefix of the caller's in-flight turn", () => {
  it("starts empty", () => {
    expect(emptyCallState().pendingCallerTurn).toBeNull();
  });

  it("appends deltas for the same item in order", () => {
    let s = withCallerDelta(emptyCallState(), "item_1", "Hello, ");
    s = withCallerDelta(s, "item_1", "please ");
    s = withCallerDelta(s, "item_1", "don't hang up.");
    expect(s.pendingCallerTurn).toEqual({ itemId: "item_1", text: "Hello, please don't hang up." });
  });

  it("a delta for a different item starts over — the previous item's prefix is not carried", () => {
    // Two caller turns never interleave on one socket, but the buffer must
    // be keyed anyway: a stale prefix from turn 1 glued onto turn 2 could
    // cross the length floor on words the caller never said together.
    let s = withCallerDelta(emptyCallState(), "item_1", "first turn text");
    s = withCallerDelta(s, "item_2", "second");
    expect(s.pendingCallerTurn).toEqual({ itemId: "item_2", text: "second" });
  });

  it("clearing leaves every other field alone", () => {
    const before = withCallerDelta(emptyCallState(), "item_1", "abc");
    const after = clearPendingCallerTurn(before);
    expect(after.pendingCallerTurn).toBeNull();
    expect({ ...after, pendingCallerTurn: before.pendingCallerTurn }).toEqual(before);
  });

  it("is pure — the input state is not mutated", () => {
    const s0 = emptyCallState();
    const s1 = withCallerDelta(s0, "item_1", "abc");
    expect(s0.pendingCallerTurn).toBeNull();
    expect(s1).not.toBe(s0);
  });

  it("clearing is pure — the input keeps its pending turn and the result is a new object", () => {
    const before = withCallerDelta(emptyCallState(), "item_1", "abc");
    const pendingBefore = before.pendingCallerTurn;
    const after = clearPendingCallerTurn(before);
    expect(after).not.toBe(before);
    expect(before.pendingCallerTurn).toBe(pendingBefore);
    expect(before.pendingCallerTurn).toEqual({ itemId: "item_1", text: "abc" });
    expect(after.pendingCallerTurn).toBeNull();
  });
});

describe("callerSpoke — the billing signal for voice minutes", () => {
  it("is true only when a CALLER turn carries words: Sofía's greeting alone, or a blank caller turn, is not the caller speaking; a robocall's recorded words are (mutation: return transcript.length > 0 → FAILS; drop .trim() → FAILS)", () => {
    expect(callerSpoke(emptyCallState())).toBe(false);
    expect(callerSpoke(withTranscript(emptyCallState(), { role: "assistant", text: "Hi, this is Sofía with Rio Roofing.", at: "t" }))).toBe(false);
    expect(callerSpoke(withTranscript(emptyCallState(), { role: "caller", text: "   ", at: "t" }))).toBe(false);
    expect(callerSpoke(withTranscript(emptyCallState(), { role: "caller", text: "hello?", at: "t" }))).toBe(true);
    expect(callerSpoke(withRecordedCaller(withTranscript(emptyCallState(),
      { role: "caller", text: "Press 1 to renew your vehicle warranty", at: "t" })))).toBe(true);
  });
});
