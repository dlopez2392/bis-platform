import { describe, it, expect } from "vitest";
import { reminderDeadline } from "./reminder-timing";

describe("reminderDeadline", () => {
  it("a day-before reminder keeps the appointment itself as its deadline", () => {
    expect(reminderDeadline({ startsAt: "2027-04-06T14:00:00.000Z", late: false }).toISOString())
      .toBe("2027-04-06T14:00:00.000Z");
  });

  it("a LATE reminder's deadline is the earliest the text reminder can go: start minus 2h15m (mutation: return the start → FAILS)", () => {
    expect(reminderDeadline({ startsAt: "2027-04-06T14:00:00.000Z", late: true }).toISOString())
      .toBe("2027-04-06T11:45:00.000Z");
  });
});
