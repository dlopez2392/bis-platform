import { describe, expect, it } from "vitest";
import { HOURS_FORM_DAYS, openHoursToRows, rowsToOpenHours } from "./hours-form";

describe("openHoursToRows / rowsToOpenHours", () => {
  it("round-trips a mixed week: some open days, some closed", () => {
    const openHours = {
      mon: [["09:00", "17:00"]] as [string, string][],
      wed: [["08:30", "12:00"]] as [string, string][],
      fri: [["09:00", "18:00"]] as [string, string][],
    };
    const rows = openHoursToRows(openHours);

    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.day)).toEqual(HOURS_FORM_DAYS);
    expect(rows.find((r) => r.day === "mon")).toEqual({ day: "mon", from: "09:00", to: "17:00" });
    // A day absent from openHours becomes a CLOSED row (both sides blank),
    // not an error.
    expect(rows.find((r) => r.day === "tue")).toEqual({ day: "tue", from: "", to: "" });

    expect(rowsToOpenHours(rows)).toEqual(openHours);
  });

  it("round-trips rows -> openHours -> rows for a fully closed week", () => {
    const rows = HOURS_FORM_DAYS.map((day) => ({ day, from: "", to: "" }));
    expect(rowsToOpenHours(rows)).toEqual({});
    expect(openHoursToRows(rowsToOpenHours(rows))).toEqual(rows);
  });

  it("collapses a day to its first interval only, dropping the rest", () => {
    const openHours = { mon: [["09:00", "12:00"], ["13:00", "17:00"]] as [string, string][] };
    expect(openHoursToRows(openHours).find((r) => r.day === "mon"))
      .toEqual({ day: "mon", from: "09:00", to: "12:00" });
  });

  it("drops a row with only one side filled in (garbage-in)", () => {
    const rows = HOURS_FORM_DAYS.map((day) =>
      day === "mon" ? { day, from: "09:00", to: "" } : { day, from: "", to: "" },
    );
    expect(rowsToOpenHours(rows)).toEqual({});
  });

  it("drops a reversed pair, to <= from (garbage-in)", () => {
    const rows = HOURS_FORM_DAYS.map((day) =>
      day === "tue" ? { day, from: "17:00", to: "09:00" } : { day, from: "", to: "" },
    );
    expect(rowsToOpenHours(rows)).toEqual({});
  });

  it("drops a malformed time string (garbage-in)", () => {
    const rows = HOURS_FORM_DAYS.map((day) =>
      day === "thu" ? { day, from: "9am", to: "5pm" } : { day, from: "", to: "" },
    );
    expect(rowsToOpenHours(rows)).toEqual({});
  });
});
