import { describe, it, expect } from "vitest";
import { formatDuration, callerLabel, DURATION_UNKNOWN, OUTCOMES } from "./format";
import { m } from "@/lib/messages";

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

/**
 * `OUTCOMES` is a `Record<CallOutcome, …>`, so the COMPILER already refuses a
 * missing key. What it cannot judge is whether the treatment says the right
 * thing, which is what this block is for — and the sixth outcome (0037's
 * `transferred`) is the one that makes the question live: it is the first
 * addition to this vocabulary since the map was written, and the easy wrong
 * answer is to give it the grey the abandoned rows wear.
 */
describe("OUTCOMES", () => {
  it("covers exactly the six outcomes the database can store", () => {
    // Hand-copied from `calls_outcome_check` (0019, widened by 0037) on
    // purpose: a type cannot be enumerated at runtime, so this list is the
    // only place the app states out loud which values it expects to meet.
    expect(Object.keys(OUTCOMES).sort()).toEqual(
      ["abandoned", "booked", "lead", "message", "spam", "transferred"],
    );
  });

  it("gives every outcome a word as well as a dot — DESIGN.md rule 3, never colour alone", () => {
    for (const [key, treatment] of Object.entries(OUTCOMES)) {
      expect(treatment.label, `${key} has no label`).toBeTruthy();
      expect(treatment.dot, `${key} has no dot`).toBeTruthy();
    }
  });

  it("paints every treatment from tokens — no hex, no rgb()", () => {
    for (const [key, treatment] of Object.entries(OUTCOMES)) {
      expect(`${treatment.dot} ${treatment.chip}`, `${key} hard-codes a colour`)
        .not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });

  it("reads 'transferred' as a POSITIVE outcome — the caller reached a person", () => {
    const t = OUTCOMES.transferred;
    // The receding pair is `abandoned` and `spam`: muted text, transparent
    // chip, a row a client should NOT be drawn to. A transfer is the opposite
    // — it is the best thing that can happen on a call the receptionist could
    // not close itself — so it must not wear either of their treatments.
    expect(t.chip).not.toContain("text-muted-foreground");
    expect(t.chip).toContain("text-foreground");
    expect(t.dot).not.toBe(OUTCOMES.abandoned.dot);
    expect(t.dot).not.toBe(OUTCOMES.spam.dot);
  });

  it("leaves `booked` the only filled chip, so the eye still finds it first", () => {
    // The map's own comment makes this a rule, not an accident. `transferred`
    // shares `booked`'s HUE — both are "the business got what it wanted", and
    // confusing the two at a glance costs nothing, where confusing a transfer
    // with a `lead` would imply intake that never happened. What separates
    // them is the fill and the word.
    expect(OUTCOMES.booked.chip).toContain("bg-success/10");
    expect(OUTCOMES.transferred.chip).not.toContain("bg-success/10");
    expect(OUTCOMES.transferred.chip).not.toBe(OUTCOMES.booked.chip);
  });

  it("takes its label from the copy catalogue, never a literal", () => {
    expect(OUTCOMES.transferred.label).toBe(m["calls.outcome.transferred"]);
    // Plain words a business owner reads at 7 AM: no template syntax, no
    // internal codes, no carrier jargon.
    expect(OUTCOMES.transferred.label).not.toMatch(/[{}]|\bM\d[a-z]?\b/);
  });
});
