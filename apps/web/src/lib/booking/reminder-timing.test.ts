import { describe, it, expect } from "vitest";
import { SMS_REMINDER_WINDOW_END_MS } from "@bis/db";
import { reminderDeadline, MORNING_OF_MIN_NOTICE_MS } from "./reminder-timing";

describe("reminderDeadline (spec §11.3, C16)", () => {
  const startsAt = "2027-04-06T14:00:00.000Z";
  const s = Date.parse(startsAt);

  it("day-before: the start, whatever texts (mutation: apply the late rule to every row -> FAILS)", () => {
    expect(reminderDeadline({ startsAt, late: false }, { textCovers: true }).getTime()).toBe(s);
    expect(reminderDeadline({ startsAt, late: false }, { textCovers: false }).getTime()).toBe(s);
  });

  it("late with a text coming: start - 2h15m, D-029 unchanged (mutation: ignore textCovers -> FAILS)", () => {
    expect(SMS_REMINDER_WINDOW_END_MS).toBe(135 * 60 * 1000);
    expect(reminderDeadline({ startsAt, late: true }, { textCovers: true }).toISOString()).toBe("2027-04-06T11:45:00.000Z");
  });

  it("late with no text: start - 45 minutes (mutation: 60 minutes -> FAILS)", () => {
    expect(MORNING_OF_MIN_NOTICE_MS).toBe(45 * 60 * 1000);
    expect(reminderDeadline({ startsAt, late: true }, { textCovers: false }).toISOString()).toBe("2027-04-06T13:15:00.000Z");
  });
});
