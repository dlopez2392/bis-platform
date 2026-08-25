import { describe, it, expect } from "vitest";
import { buildSummaryInput, summaryFactLine, checkSummaryAgainstState, composeSummary } from "./summarize";
import { emptyCallState, withBooking, withLead, withTranscript } from "./call-state";

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
