import { describe, it, expect } from "vitest";
import { buildSummaryInput, summaryFactLine, checkSummaryAgainstState, composeSummary } from "./summarize";
import { emptyCallState, withBooking, withLead, withServed } from "./call-state";

describe("layer 1 — buildSummaryInput", () => {
  it("renders (none) markers, never blanks", () => {
    const input = buildSummaryInput(emptyCallState());
    expect(input).toContain("BOOKED:\n(none)");
    expect(input).toContain("INTAKE:\n(none)");
    expect(input).toContain("(no speech captured)");
  });
});

describe("layer 2 — summaryFactLine", () => {
  it("states the negative plainly", () => {
    expect(summaryFactLine(emptyCallState())).toContain("no appointment was recorded");
  });
  it("names a real booking", () => {
    const s = withBooking(emptyCallState(), { id: "b1", contactName: "Ana", startsAt: "2027-06-01T14:00:00Z", endsAt: "x" });
    expect(summaryFactLine(s)).toContain("Ana");
  });
});

describe("layer 3 — mismatch detection (the 3 production fabrications)", () => {
  it("flags 'successfully booked' against an empty state — even with a trailing negation elsewhere", () => {
    const prose = "The caller requested an appointment, which has been successfully booked. No follow-up is needed at this time.";
    const check = checkSummaryAgainstState(prose, emptyCallState());
    expect(check.claimsBooking).toBe(true);
    expect(composeSummary(prose, emptyCallState())).toContain("⚠ MISMATCH");
  });
  it("does NOT flag an honest negative", () => {
    const prose = "The caller hung up before speaking. No appointment was booked.";
    expect(checkSummaryAgainstState(prose, emptyCallState()).claimsBooking).toBe(false);
  });
  it("does NOT flag a claim that state supports", () => {
    const s = withBooking(emptyCallState(), { id: "b1", contactName: "Ana", startsAt: "x", endsAt: "y" });
    expect(checkSummaryAgainstState("An appointment was booked for Ana.", s).claimsBooking).toBe(false);
  });
  it("keeps the prose under the banner (the caller may have been told)", () => {
    const out = composeSummary("An appointment was scheduled.", emptyCallState());
    expect(out).toContain("An appointment was scheduled.");
    expect(out.indexOf("RECORDED")).toBeLessThan(out.indexOf("⚠ MISMATCH"));
    expect(out.indexOf("⚠ MISMATCH")).toBeLessThan(out.indexOf("An appointment was scheduled."));
  });
  it("flags intake claims against empty leads", () => {
    const prose = "The caller's phone number was captured for follow-up.";
    expect(checkSummaryAgainstState(prose, emptyCallState()).claimsIntake).toBe(true);
    const s = withLead(emptyCallState(), { fields: { fullName: "Ana" } });
    expect(checkSummaryAgainstState(prose, s).claimsIntake).toBe(false);
  });
});

/**
 * A handed-off call's transcript is a HALF of a call: it holds everything the
 * receptionist heard and nothing the person who took over said. The fact line
 * is the first thing a human reads, and it is the only place that can admit
 * it — the prose below it is written by a model that was handed the same
 * partial transcript and has no way to know it was partial.
 *
 * The handoff is recorded as the fourth `ServedAction` and read from there,
 * NOT as a second boolean beside it. One fact, one field: a transfer has two
 * consumers with opposite failure modes — miss the served entry and a caller
 * who was successfully put through to a person gets texted "Sorry we missed
 * you just now"; miss the fact line and half a call is summarised as a whole
 * one. Two fields means two chances to write only one of them.
 */
describe("layer 2 — summaryFactLine on a handed-off call", () => {
  it("says the transcript stops at the handoff, so half a call cannot read as a whole one", () => {
    const s = withServed(emptyCallState(), "transferred");
    const line = summaryFactLine(s);
    expect(line).toMatch(/transcript ends at the handoff/i);
    // Plain words, no jargon and no template syntax — a business owner reads
    // this at 7 AM, in the dashboard and in the alert email.
    expect(line).not.toMatch(/[{}]|\bM\d[a-z]?\b/);
  });

  it("leads with it, ahead of the booking and intake facts", () => {
    // A partial record has to be the FIRST thing read, not a clause after two
    // lines of accounting the reader has already started trusting.
    const line = summaryFactLine(withServed(emptyCallState(), "transferred"));
    // Both indices asserted present first: `indexOf` returns -1 for a missing
    // needle, and -1 is less than everything — a positional test that does not
    // check for presence passes loudest when the thing is absent.
    expect(line).toContain("handoff");
    expect(line).toContain("Intake");
    expect(line.indexOf("handoff")).toBeLessThan(line.indexOf("Intake"));
  });

  it("says nothing of the sort on an ordinary call", () => {
    // Every call this product has ever recorded takes this branch, so a
    // handoff sentence leaking into it would be a lie on every row.
    expect(summaryFactLine(emptyCallState())).not.toMatch(/handoff/i);
  });
});
