import { describe, it, expect } from "vitest";
import { nextOpening, expiresBeforeOpening, hoursZone } from "./hours";

const CHI = "America/Chicago";
const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("nextOpening: automated hours, 08:00-21:00 every day", () => {
  it("20:59 sends, 21:00 waits for tomorrow's 08:00 (mutation: `< CLOSE` → `<= CLOSE` → FAILS)", () => {
    // Tue 2026-10-06, CDT (UTC-5).
    expect(nextOpening("automated", at("2026-10-07T01:59:00Z"), CHI)).toBeNull();
    expect(iso(nextOpening("automated", at("2026-10-07T02:00:00Z"), CHI))).toBe("2026-10-07T13:00:00.000Z");
  });

  it("07:59 waits for today's 08:00, and 08:00 sends (mutation: `>= open` → `> open` → FAILS)", () => {
    expect(iso(nextOpening("automated", at("2026-10-06T12:59:00Z"), CHI))).toBe("2026-10-06T13:00:00.000Z");
    expect(nextOpening("automated", at("2026-10-06T13:00:00Z"), CHI)).toBeNull();
  });

  it("the recipient's zone decides: one instant, two zones, two answers (mutation: ignore `zone` → FAILS)", () => {
    const t = at("2026-10-06T13:30:00Z"); // 08:30 in Chicago, 06:30 in Los Angeles
    expect(nextOpening("automated", t, CHI)).toBeNull();
    expect(iso(nextOpening("automated", t, "America/Los_Angeles"))).toBe("2026-10-06T15:00:00.000Z");
  });

  it("an unresolvable zone reads as America/Chicago, never as no window and never as UTC (mutation: fall back to UTC → FAILS)", () => {
    const t = at("2026-10-06T12:00:00Z"); // 07:00 in Chicago, 12:00 in UTC
    expect(iso(nextOpening("automated", t, "America/Nowhere"))).toBe("2026-10-06T13:00:00.000Z");
    expect(iso(nextOpening("automated", t, null))).toBe("2026-10-06T13:00:00.000Z");
    expect(nextOpening("automated", t, "UTC")).toBeNull();
    expect(hoursZone("America/Nowhere")).toBe(CHI);
  });

  it("SPRING FORWARD (Sun 2026-03-08): held at 01:30 CST, it opens at 08:00 CDT = 13:00Z (mutation: compute the opening from the offset in force at `now` — 01:30 CST is -6h — instead of the offset AT the opening → 14:00Z, FAILS)", () => {
    expect(iso(nextOpening("automated", at("2026-03-08T07:30:00Z"), CHI))).toBe("2026-03-08T13:00:00.000Z");
  });

  it("FALL BACK (Sun 2026-11-01): held at 00:30 CDT, it opens at 08:00 CST = 14:00Z (mutation: compute the opening from the offset in force at `now` — 00:30 CDT is -5h — instead of the offset AT the opening → 13:00Z, FAILS)", () => {
    expect(iso(nextOpening("automated", at("2026-11-01T05:30:00Z"), CHI))).toBe("2026-11-01T14:00:00.000Z");
  });

  it("an invalid `now` throws rather than failing open (mutation: `throw` → `return null` → FAILS, a bad instant would read as \"inside the window, send now\")", () => {
    expect(() => nextOpening("automated", new Date(NaN), CHI)).toThrow(/invalid instant/);
  });
});

describe("nextOpening: marketing hours, 09:00-21:00, Sunday from noon", () => {
  it("Saturday 08:59 waits for 09:00; 09:00 sends (mutation: marketing opens at 08:00 → FAILS)", () => {
    // Sat 2026-10-10, CDT.
    expect(iso(nextOpening("marketing", at("2026-10-10T13:59:00Z"), CHI))).toBe("2026-10-10T14:00:00.000Z");
    expect(nextOpening("marketing", at("2026-10-10T14:00:00Z"), CHI)).toBeNull();
  });

  it("Sunday 11:59 waits for noon; 12:00 sends (mutation: drop the Sunday rule → FAILS)", () => {
    // Sun 2026-10-11, CDT.
    expect(iso(nextOpening("marketing", at("2026-10-11T16:59:00Z"), CHI))).toBe("2026-10-11T17:00:00.000Z");
    expect(nextOpening("marketing", at("2026-10-11T17:00:00Z"), CHI)).toBeNull();
  });

  it("Saturday 21:00 opens on SUNDAY'S noon, the next day's own rule (mutation: use today's weekday for tomorrow → FAILS)", () => {
    expect(iso(nextOpening("marketing", at("2026-10-11T02:00:00Z"), CHI))).toBe("2026-10-11T17:00:00.000Z");
  });

  it("the Sunday of the fall-back change opens at noon CST = 18:00Z (mutation: compute the opening from the offset in force at `now` — 00:30 CDT is -5h — instead of the offset AT the opening → 17:00Z, FAILS)", () => {
    expect(iso(nextOpening("marketing", at("2026-11-01T05:30:00Z"), CHI))).toBe("2026-11-01T18:00:00.000Z");
  });

  it("the automated window is open at 08:30 on a Sunday while marketing is not: the rule decides (mutation: drop the `automated` branch in `openingMinute` so it shares marketing's Sunday-noon rule → automated is no longer null, FAILS)", () => {
    const t = at("2026-10-11T13:30:00Z");
    expect(nextOpening("automated", t, CHI)).toBeNull();
    expect(iso(nextOpening("marketing", t, CHI))).toBe("2026-10-11T17:00:00.000Z");
  });
});

describe("nextOpening: any", () => {
  it("never waits, at 03:00 or at any hour (mutation: treat `any` as automated → FAILS)", () => {
    expect(nextOpening("any", at("2026-10-06T08:00:00Z"), CHI)).toBeNull();
  });
});

describe("expiresBeforeOpening: choice 21", () => {
  const opening = at("2026-10-06T13:00:00Z");
  it("a deadline at or before the opening expires; one a minute after does not (mutation: `<=` → `<` → FAILS)", () => {
    expect(expiresBeforeOpening(opening, at("2026-10-06T12:30:00Z"))).toBe(true);
    expect(expiresBeforeOpening(opening, at("2026-10-06T13:00:00Z"))).toBe(true);
    expect(expiresBeforeOpening(opening, at("2026-10-06T13:01:00Z"))).toBe(false);
  });

  it("an open window never expires (mutation: drop the `opening === null` guard → throws reading `opening.getTime()`, FAILS)", () => {
    expect(expiresBeforeOpening(null, at("2026-10-06T12:30:00Z"))).toBe(false);
  });

  it("no deadline (`null`) never expires (mutation: `!deadline` → `deadline === undefined` → FAILS, `null` would fall through to `deadline.getTime()`)", () => {
    expect(expiresBeforeOpening(opening, null)).toBe(false);
  });

  it("no deadline (`undefined`) never expires either (mutation: `!deadline` → `deadline === null` → FAILS, `undefined` would fall through to `deadline.getTime()`)", () => {
    expect(expiresBeforeOpening(opening, undefined)).toBe(false);
  });

  it("an unreadable (Invalid Date) deadline is treated as already passed, so the stale send is held rather than sent (mutation: drop the `Number.isFinite` check → NaN <= opening is false, FAILS)", () => {
    expect(expiresBeforeOpening(opening, new Date("nope"))).toBe(true);
  });
});

/**
 * Review R1-M6: the tests above run in America/Chicago, the machine's own
 * zone, so a leak of the process zone could pass them. These use zones
 * whose clocks jump at MIDNIGHT (Havana) and a Pacific zone.
 */
describe("nextOpening: DST away from the machine's zone", () => {
  it("Havana springs forward AT midnight (2026-03-08, 00:00 CST → 01:00 CDT): at 22:00 the day before, the opening is 08:00 CDT, 12:00Z (mutation: open on the local 08:00 of the pre-shift offset → 13:00Z, FAILS)", () => {
    expect(iso(nextOpening("automated", at("2026-03-08T03:00:00Z"), "America/Havana"))).toBe("2026-03-08T12:00:00.000Z");
    // 01:30 CDT, just after the missing hour: still the same 08:00.
    expect(iso(nextOpening("automated", at("2026-03-08T05:30:00Z"), "America/Havana"))).toBe("2026-03-08T12:00:00.000Z");
  });

  it("Los Angeles, spring forward (2026-03-08, 02:00 PST → 03:00 PDT): 01:00 PST waits for 08:00 PDT, 15:00Z; marketing on that Sunday waits for noon, 19:00Z (mutation: open on the machine's local clock → FAILS)", () => {
    expect(iso(nextOpening("automated", at("2026-03-08T09:00:00Z"), "America/Los_Angeles"))).toBe("2026-03-08T15:00:00.000Z");
    expect(iso(nextOpening("marketing", at("2026-03-08T09:00:00Z"), "America/Los_Angeles"))).toBe("2026-03-08T19:00:00.000Z");
  });

  it("Los Angeles, fall back (2026-11-01, 02:00 PDT → 01:00 PST): at the first 01:30 the opening is 08:00 PST, 16:00Z (mutation: open on the machine's local clock → FAILS)", () => {
    expect(iso(nextOpening("automated", at("2026-11-01T08:30:00Z"), "America/Los_Angeles"))).toBe("2026-11-01T16:00:00.000Z");
  });

  it("Pacific/Auckland's Sunday is still Saturday in UTC: the ZONE's weekday decides, not UTC's (mutation: read `wall.weekday` from `instant.getUTCDay()` instead of the zone's own Intl weekday → FAILS)", () => {
    // 2026-10-10T21:00:00Z is Sunday 2026-10-11, 10:00 NZDT (UTC+13) — Saturday
    // in UTC (`instant.getUTCDay()` is 6). Marketing hasn't opened (noon local)
    // yet, so this waits for noon NZDT = 2026-10-10T23:00:00Z.
    expect(iso(nextOpening("marketing", at("2026-10-10T21:00:00Z"), "Pacific/Auckland"))).toBe("2026-10-10T23:00:00.000Z");
  });
});
