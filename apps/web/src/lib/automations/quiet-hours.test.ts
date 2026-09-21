import { describe, it, expect } from "vitest";
import {
  clockMinutes, inQuietWindow, quietWindowEnd, formatClock, formatInstantClock, type QuietSettings,
} from "./quiet-hours";

const CHI = "America/Chicago";
const DEFAULT: QuietSettings = { enabled: true, start: "21:00", end: "08:00" };
// 2026-09-21 is CDT (UTC-5): 21:00 CDT = 02:00Z next day; 08:00 CDT = 13:00Z.
const at = (iso: string) => new Date(iso);

describe("clockMinutes", () => {
  it("reads HH:MM and refuses everything else", () => {
    expect(clockMinutes("21:00")).toBe(1260);
    expect(clockMinutes("00:00")).toBe(0);
    expect(clockMinutes("23:59")).toBe(1439);
    for (const bad of ["24:00", "9:00", "21:60", "9pm", "", "21:00:00"]) expect(clockMinutes(bad), bad).toBeNull();
  });
});

describe("inQuietWindow — the default window, crossing midnight, on Chicago's wall clock", () => {
  it("is quiet at 23:00 and 03:00, not at 12:00 or 20:59", () => {
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, DEFAULT)).toBe(true);    // 23:00 CDT
    expect(inQuietWindow(at("2026-09-22T08:00:00Z"), CHI, DEFAULT)).toBe(true);    // 03:00 CDT
    expect(inQuietWindow(at("2026-09-21T17:00:00Z"), CHI, DEFAULT)).toBe(false);   // 12:00 CDT
    expect(inQuietWindow(at("2026-09-22T01:59:00Z"), CHI, DEFAULT)).toBe(false);   // 20:59 CDT
  });

  it("the start edge is inside and the end edge is outside (mutation: >= to > on start, or < to <= on end → FAILS)", () => {
    expect(inQuietWindow(at("2026-09-22T02:00:00Z"), CHI, DEFAULT)).toBe(true);    // 21:00:00 CDT exactly
    expect(inQuietWindow(at("2026-09-22T12:59:59Z"), CHI, DEFAULT)).toBe(true);    // 07:59:59 CDT
    expect(inQuietWindow(at("2026-09-22T13:00:00Z"), CHI, DEFAULT)).toBe(false);   // 08:00:00 CDT exactly
  });

  it("a window that does NOT cross midnight (13:00–15:00) is quiet only between those hours", () => {
    const s = { enabled: true, start: "13:00", end: "15:00" };
    expect(inQuietWindow(at("2026-09-21T18:00:00Z"), CHI, s)).toBe(true);    // 13:00 CDT exactly — the start edge is inside on this branch too
    expect(inQuietWindow(at("2026-09-21T19:00:00Z"), CHI, s)).toBe(true);    // 14:00 CDT
    expect(inQuietWindow(at("2026-09-21T17:59:00Z"), CHI, s)).toBe(false);   // 12:59 CDT
    expect(inQuietWindow(at("2026-09-21T20:00:00Z"), CHI, s)).toBe(false);   // 15:00 CDT
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, s)).toBe(false);   // 23:00 CDT — not quiet under this window
  });

  it("start === end means disabled, and so does enabled:false (mutation: drop either guard → FAILS)", () => {
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, { enabled: true, start: "08:00", end: "08:00" })).toBe(false);
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, { ...DEFAULT, enabled: false })).toBe(false);
  });

  it("the account's zone decides, never the machine's: one instant, two zones, two answers", () => {
    const instant = at("2026-09-21T09:00:00Z");   // 23:00 HST (Sept 20) · 18:00 JST (Sept 21)
    expect(inQuietWindow(instant, "Pacific/Honolulu", DEFAULT)).toBe(true);
    expect(inQuietWindow(instant, "Asia/Tokyo", DEFAULT)).toBe(false);
    const noon = at("2026-09-21T03:00:00Z");      // 12:00 JST · 17:00 HST (the previous day)
    expect(inQuietWindow(noon, "Asia/Tokyo", DEFAULT)).toBe(false);
    expect(inQuietWindow(noon, "Pacific/Honolulu", DEFAULT)).toBe(false);
  });

  it("fails CLOSED (not quiet) on a zone Intl cannot resolve or an invalid instant — never throws inside a tick", () => {
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), "Mars/Olympus", DEFAULT)).toBe(false);
    expect(inQuietWindow(new Date(NaN), CHI, DEFAULT)).toBe(false);
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, { enabled: true, start: "9pm", end: "08:00" })).toBe(false);
  });
});

describe("quietWindowEnd — the next 08:00 on the wall clock, as a UTC instant", () => {
  it("at 23:00 the window ends at tomorrow's 08:00; at 03:00 at today's 08:00", () => {
    expect(quietWindowEnd(at("2026-09-22T04:00:00Z"), CHI, DEFAULT)?.toISOString()).toBe("2026-09-22T13:00:00.000Z");
    expect(quietWindowEnd(at("2026-09-22T08:00:00Z"), CHI, DEFAULT)?.toISOString()).toBe("2026-09-22T13:00:00.000Z");
  });

  it("returns null outside the window (mutation: return today's end unconditionally → FAILS)", () => {
    expect(quietWindowEnd(at("2026-09-21T17:00:00Z"), CHI, DEFAULT)).toBeNull();
    expect(quietWindowEnd(at("2026-09-22T04:00:00Z"), CHI, { ...DEFAULT, enabled: false })).toBeNull();
  });

  it("a non-crossing window ends at today's end", () => {
    expect(quietWindowEnd(at("2026-09-21T19:00:00Z"), CHI, { enabled: true, start: "13:00", end: "15:00" })?.toISOString())
      .toBe("2026-09-21T20:00:00.000Z");
  });

  it("SPRING FORWARD (2026-03-08, 02:00 CST → 03:00 CDT): held at 01:30 CST, the end is 08:00 CDT = 13:00Z, and the wall clock reads 08:00", () => {
    const end = quietWindowEnd(at("2026-03-08T07:30:00Z"), CHI, DEFAULT)!;
    expect(end.toISOString()).toBe("2026-03-08T13:00:00.000Z");   // NOT 14:00Z (the pre-shift offset applied blindly)
    expect(formatInstantClock(end, CHI)).toBe("8:00 AM");
  });

  it("FALL BACK (2026-11-01, 02:00 CDT → 01:00 CST): held at 00:30 CDT, the end is 08:00 CST = 14:00Z, and the wall clock reads 08:00", () => {
    const end = quietWindowEnd(at("2026-11-01T05:30:00Z"), CHI, DEFAULT)!;
    expect(end.toISOString()).toBe("2026-11-01T14:00:00.000Z");   // NOT 13:00Z
    expect(formatInstantClock(end, CHI)).toBe("8:00 AM");
  });

  it("the requested end falls IN the spring-forward gap (Chicago 02:00→03:00): the answer is the gap's end, not a pre-gap instant an hour early", () => {
    // measured: the naive two-iteration fixed point for 2026-03-08 02:30 (Chicago) converges
    // to 2026-03-08T07:30:00Z, which READS 01:30 local — an hour BEFORE the requested 02:30,
    // because 02:30 never happens that day (01:59:59 CST jumps straight to 03:00:00 CDT).
    const end = quietWindowEnd(at("2026-03-08T07:30:00Z"), CHI, { enabled: true, start: "21:00", end: "02:30" })!;
    expect(end.toISOString()).toBe("2026-03-08T08:00:00.000Z");   // the gap's end: 03:00 CDT
    expect(formatInstantClock(end, CHI)).toBe("3:00 AM");
  });

  it("the requested end falls IN Havana's own midnight gap (00:00→01:00): the answer is never in the past relative to now", () => {
    // Havana springs forward at local midnight on 2026-03-08 (23:59:59 CST on the 7th jumps
    // straight to 01:00:00 CDT on the 8th), so a window ending at "00:00" asked for that date
    // requests a wall time that never happens. Measured: 2026-03-08T04:30:00Z reads 23:30 on
    // 2026-03-07 in America/Havana (this is the corrected instant for "23:30 local the night
    // Havana springs forward" — 2026-03-08T03:30:00Z, as originally suggested, actually reads
    // 22:30 local, still inside the window but not the instant described).
    const now = at("2026-03-08T04:30:00Z");
    const end = quietWindowEnd(now, "America/Havana", { enabled: true, start: "21:00", end: "00:00" })!;
    expect(end.getTime()).toBeGreaterThanOrEqual(now.getTime());   // never in the past relative to now
    expect(end.toISOString()).toBe("2026-03-08T05:00:00.000Z");    // the gap's end: 01:00 CDT
    expect(formatInstantClock(end, "America/Havana")).toBe("1:00 AM");
  });

  it("east and west of UTC: the end lands on the wall clock's 08:00 in each zone", () => {
    expect(quietWindowEnd(at("2026-09-21T14:00:00Z"), "Asia/Tokyo", DEFAULT)?.toISOString()).toBe("2026-09-21T23:00:00.000Z");     // 08:00 JST Sept 22
    expect(quietWindowEnd(at("2026-09-21T09:00:00Z"), "Pacific/Honolulu", DEFAULT)?.toISOString()).toBe("2026-09-21T18:00:00.000Z"); // 08:00 HST Sept 21
  });
});

describe("formatting", () => {
  it("renders HH:MM and instants as the clock a business owner reads", () => {
    expect(formatClock("21:00")).toBe("9:00 PM");
    expect(formatClock("08:00")).toBe("8:00 AM");
    expect(formatClock("00:30")).toBe("12:30 AM");
    expect(formatClock("junk")).toBe("junk");   // never throws; the raw value is better than a crash on a settings page
    expect(formatInstantClock(at("2026-09-22T13:00:00Z"), CHI)).toBe("8:00 AM");
    expect(formatInstantClock(at("2026-09-22T13:00:00Z"), "Asia/Tokyo")).toBe("10:00 PM");
    expect(formatInstantClock(at("2026-09-22T13:00:00Z"), "Mars/Olympus")).toBe("1:00 PM");   // unresolvable zone → UTC fallback
    expect(formatInstantClock(new Date(NaN), CHI)).toBe("?");   // never throws; matches formatClock's own contract
  });
});
