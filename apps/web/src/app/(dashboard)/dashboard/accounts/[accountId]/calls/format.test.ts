import { describe, it, expect } from "vitest";
import { formatDuration, callerLabel, DURATION_UNKNOWN } from "./format";

describe("formatDuration", () => {
  it("renders m:ss with a zero-padded seconds field", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(62)).toBe("1:02");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("keeps counting in minutes past an hour rather than rolling to h:mm:ss", () => {
    // A receptionist call log is a minutes-scale artifact; "61:01" stays
    // directly comparable to the rows above it, "1:01:01" does not.
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("floors fractional seconds instead of printing a decimal", () => {
    expect(formatDuration(62.9)).toBe("1:02");
  });

  it("renders an em dash when there is no duration to show", () => {
    // An abandoned call is finished with no duration at all, and a call still
    // in flight has not been finished yet — neither is "0:00", which would
    // read as a real, measured, instantaneous call.
    expect(formatDuration(null)).toBe(DURATION_UNKNOWN);
    expect(DURATION_UNKNOWN).toBe("—");
  });

  it("refuses impossible durations rather than printing nonsense", () => {
    expect(formatDuration(-5)).toBe(DURATION_UNKNOWN);
    expect(formatDuration(Number.NaN)).toBe(DURATION_UNKNOWN);
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe(DURATION_UNKNOWN);
  });
});

describe("callerLabel", () => {
  it("prefers the matched contact's name over the raw number", () => {
    expect(
      callerLabel({
        caller_e164: "+19565061545",
        contact: { first_name: "Ana", last_name: "Reyes" },
      }),
    ).toBe("Ana Reyes");
  });

  it("joins on whichever name parts exist", () => {
    expect(callerLabel({ caller_e164: null, contact: { first_name: "Ana", last_name: null } }))
      .toBe("Ana");
    expect(callerLabel({ caller_e164: null, contact: { first_name: null, last_name: "Reyes" } }))
      .toBe("Reyes");
  });

  it("falls through to the number when a linked contact has no name at all", () => {
    // contactDisplayName would return "(no name)" here — a worse label than
    // the number the caller actually rang from.
    expect(
      callerLabel({
        caller_e164: "+19565061545",
        contact: { first_name: null, last_name: "   " },
      }),
    ).toBe("+19565061545");
  });

  it("falls back to the caller's number when no contact was matched", () => {
    expect(callerLabel({ caller_e164: "+19565061545", contact: null })).toBe("+19565061545");
  });

  it("says Unknown caller when the number was withheld and no contact matched", () => {
    expect(callerLabel({ caller_e164: null, contact: null })).toBe("Unknown caller");
    expect(callerLabel({ caller_e164: "  ", contact: null })).toBe("Unknown caller");
  });
});
