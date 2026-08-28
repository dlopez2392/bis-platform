import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPEN_TIME, DEFAULT_CLOSE_TIME, seedTimeOnPickerOpen,
  HOURS_FORM_DAYS, openHoursToRows, rowsToOpenHours,
} from "./hours-form";

/**
 * Stands in for the `<input type="time">` the real handler is handed
 * (`e.currentTarget`), but COUNTS writes as well as recording them. "Did not
 * change the value" is the weaker assertion; the invariant that matters is
 * that the handler does not touch the DOM node at all when the operator
 * already has a value in it — a same-string assignment to a live input is
 * still a write, and this is the only level at which that is observable.
 */
function fakeTimeInput(initial: string) {
  let current = initial;
  let writes = 0;
  return {
    get value() { return current; },
    set value(next: string) { writes += 1; current = next; },
    get writeCount() { return writes; },
  };
}

describe("seedTimeOnPickerOpen", () => {
  it("seeds an empty field with the fallback so the picker opens there, never at the wall clock", () => {
    const from = fakeTimeInput("");
    seedTimeOnPickerOpen(from, DEFAULT_OPEN_TIME);
    expect(from.value).toBe("08:00");

    const to = fakeTimeInput("");
    seedTimeOnPickerOpen(to, DEFAULT_CLOSE_TIME);
    expect(to.value).toBe("18:00");
  });

  it("never touches a value the operator already set", () => {
    const typed = fakeTimeInput("07:03");
    seedTimeOnPickerOpen(typed, DEFAULT_OPEN_TIME);
    expect(typed.value).toBe("07:03");
    expect(typed.writeCount).toBe(0);

    // A midnight close is a real, deliberate value (rowsToOpenHours remaps it
    // to the engine's "24:00"), not an empty field wearing a zero.
    const midnight = fakeTimeInput("00:00");
    seedTimeOnPickerOpen(midnight, DEFAULT_CLOSE_TIME);
    expect(midnight.value).toBe("00:00");
    expect(midnight.writeCount).toBe(0);
  });

  it("seeds once and then leaves the field alone — nothing re-seeds or re-clears it", () => {
    // The operator opens the picker on a blank day (seed), picks 09:30, then
    // opens it again. The second open must be a no-op: this handler is the
    // only thing that writes to the field, and it is deliberately one-way.
    const field = fakeTimeInput("");
    seedTimeOnPickerOpen(field, DEFAULT_OPEN_TIME);
    field.value = "09:30";
    seedTimeOnPickerOpen(field, DEFAULT_OPEN_TIME);
    expect(field.value).toBe("09:30");
    expect(field.writeCount).toBe(2); // the seed and the operator's own pick
  });

  it("pins the business defaults", () => {
    expect(DEFAULT_OPEN_TIME).toBe("08:00");
    expect(DEFAULT_CLOSE_TIME).toBe("18:00");
  });
});

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

  it("round-trips a midnight close (22:00-00:00) instead of silently dropping it, while a genuinely reversed pair still drops (I4)", () => {
    // `<input type="time">` has no way to type "24:00" — the picker only
    // offers 00:00 through 23:59 — but "24:00" is the ONLY spelling
    // `normalizeOpenHours`/`computeSlots` accept for "open until midnight".
    // Without the fix, a "00:00" close reads as `to <= from` (00:00 <= 22:00)
    // and the whole interval is dropped by `normalizeOpenHours`'s own
    // garbage-gate — a closed day, behind a green toast.
    const midnightClose = HOURS_FORM_DAYS.map((day) =>
      day === "fri" ? { day, from: "22:00", to: "00:00" } : { day, from: "", to: "" },
    );
    const openHours = rowsToOpenHours(midnightClose);
    expect(openHours).toEqual({ fri: [["22:00", "24:00"]] });
    expect(openHoursToRows(openHours)).toEqual(midnightClose);

    // A genuinely reversed pair is still garbage, midnight fix or not.
    const reversed = HOURS_FORM_DAYS.map((day) =>
      day === "tue" ? { day, from: "17:00", to: "09:00" } : { day, from: "", to: "" },
    );
    expect(rowsToOpenHours(reversed)).toEqual({});
  });
});
