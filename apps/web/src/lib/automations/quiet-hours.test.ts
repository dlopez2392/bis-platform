import { describe, it, expect } from "vitest";
import { wallInstant, formatInstantClock } from "./quiet-hours";

const CHI = "America/Chicago";
const at = (iso: string) => new Date(iso);

/**
 * The wall-clock fixed point that lib/consent/hours.ts (the fixed sending
 * hours) and lib/reports/month-window.ts stand on. The per-account window
 * these tests used to reach it through is retired (consent chain PR-1); the
 * DST and gap cases are the same instants, asked of `wallInstant` directly.
 */
describe("wallInstant — a wall time in a zone, as a UTC instant", () => {
  it("SPRING FORWARD (2026-03-08, 02:00 CST → 03:00 CDT): 08:00 that day is 13:00Z and reads 08:00 (mutation: apply the pre-shift offset → 14:00Z, FAILS)", () => {
    const t = wallInstant(2026, 3, 8, 8 * 60, CHI);
    expect(t.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(formatInstantClock(t, CHI)).toBe("8:00 AM");
  });

  it("FALL BACK (2026-11-01, 02:00 CDT → 01:00 CST): 08:00 that day is 14:00Z", () => {
    expect(wallInstant(2026, 11, 1, 8 * 60, CHI).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("a wall time IN the spring-forward gap (Chicago 02:30 that never happens) is the gap's end, 03:00 CDT — never an hour early (mutation: drop the gap search → 07:30Z, FAILS)", () => {
    const t = wallInstant(2026, 3, 8, 2 * 60 + 30, CHI);
    expect(t.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(formatInstantClock(t, CHI)).toBe("3:00 AM");
  });

  it("Havana's own midnight gap: 00:00 on 2026-03-08 is the gap's end, 01:00 CDT, never the previous day", () => {
    const t = wallInstant(2026, 3, 8, 0, "America/Havana");
    expect(t.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(formatInstantClock(t, "America/Havana")).toBe("1:00 AM");
  });

  it("east and west of UTC: 08:00 lands on each zone's own wall clock", () => {
    expect(wallInstant(2026, 9, 22, 8 * 60, "Asia/Tokyo").toISOString()).toBe("2026-09-21T23:00:00.000Z");
    expect(wallInstant(2026, 9, 21, 8 * 60, "Pacific/Honolulu").toISOString()).toBe("2026-09-21T18:00:00.000Z");
  });
});

describe("formatInstantClock", () => {
  it("renders an instant as the clock a business owner reads, in the zone asked, and never throws", () => {
    expect(formatInstantClock(at("2026-09-22T13:00:00Z"), CHI)).toBe("8:00 AM");
    expect(formatInstantClock(at("2026-09-22T13:00:00Z"), "Asia/Tokyo")).toBe("10:00 PM");
    expect(formatInstantClock(at("2026-09-22T13:00:00Z"), "Mars/Olympus")).toBe("1:00 PM");   // unresolvable zone → UTC
    expect(formatInstantClock(new Date(NaN), CHI)).toBe("?");
  });
});
