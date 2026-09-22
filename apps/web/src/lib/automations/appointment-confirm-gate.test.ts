import { describe, it, expect } from "vitest";
import { APPOINTMENT_CONFIRM_MIN_LEAD_MS } from "@bis/db";
import { appointmentConfirmDeadline, tooCloseToAsk } from "./appointment-confirm-gate";

const NOW = new Date("2027-04-12T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("the confirmation ask's deadline", () => {
  it("is exactly 24 hours and 15 minutes before the appointment", () => {
    // LITERAL on both sides. Building the expectation out of
    // APPOINTMENT_CONFIRM_MIN_LEAD_MS would make this red only if
    // appointmentConfirmDeadline flipped its arithmetic SIGN — the constant
    // and the expectation would move together and the number itself would
    // never be pinned. 2027-04-14T11:00Z minus 24h15m is 2027-04-13T10:45Z.
    expect(appointmentConfirmDeadline(new Date("2027-04-14T11:00:00.000Z")).toISOString())
      .toBe("2027-04-13T10:45:00.000Z");
    // Mutation A: `startsAt.getTime() + APPOINTMENT_CONFIRM_MIN_LEAD_MS` -> red.
    // Mutation B: set the constant back to a flat 24h -> also red, which is
    // the half the derived version could not see.
  });

  it("is too close to ask AT the lead and one millisecond inside it, not one millisecond outside", () => {
    // The boundary, tested AT the boundary and 1ms either side. A fixture a
    // day past the bound would pass against any lead value. These three ARE
    // built from the constant on purpose — the case is about the comparison
    // operator, not the number, and the number is pinned above and in
    // cron-coupling.test.ts.
    expect(tooCloseToAsk(NOW, at(APPOINTMENT_CONFIRM_MIN_LEAD_MS - 1))).toBe(true);
    expect(tooCloseToAsk(NOW, at(APPOINTMENT_CONFIRM_MIN_LEAD_MS))).toBe(true);
    expect(tooCloseToAsk(NOW, at(APPOINTMENT_CONFIRM_MIN_LEAD_MS + 1))).toBe(false);
    // Mutation: change the comparison to `<` — the exactly-at-the-lead row
    // goes red BY NAME and nothing else moves.
  });

  it("an appointment already in the past is too close, and an unreadable instant fails CLOSED", () => {
    expect(tooCloseToAsk(NOW, at(-3600_000))).toBe(true);
    expect(tooCloseToAsk(NOW, new Date("nonsense"))).toBe(true);
    expect(tooCloseToAsk(new Date("nonsense"), at(47 * 3600_000))).toBe(true);
    // Mutation: return false on a NaN instant — TWO of these three go red
    // (the two NaN ones), not all three: an appointment an hour in the past
    // has a lead of -3,600,000, which is finite, never reaches the guard,
    // and is `true` by the comparison alone. Fail closed is the house rule
    // for a stamp that cannot be trusted.
  });
});
