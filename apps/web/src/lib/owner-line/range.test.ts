import { describe, it, expect } from "vitest";
import { resolveRange } from "./range";

const Z = "America/Chicago";
const NOW = new Date("2026-11-09T15:00:00.000Z");   // Monday 9:00 AM CST (DST ended 2026-11-01)

describe("resolveRange (spec §5: always in the account's zone, at most 31 days)", () => {
  it("today, yesterday and tomorrow are whole local days", () => {
    expect(resolveRange({ range: "today" }, Z, NOW)).toEqual({ ok: true, fromIso: "2026-11-09T06:00:00.000Z",
      toIso: "2026-11-10T06:00:00.000Z", firstDay: "2026-11-09", lastDay: "2026-11-09", multiDay: false });
    expect(resolveRange({ range: "yesterday" }, Z, NOW)).toMatchObject({ fromIso: "2026-11-08T06:00:00.000Z", toIso: "2026-11-09T06:00:00.000Z" });
    expect(resolveRange({ range: "tomorrow" }, Z, NOW)).toMatchObject({ fromIso: "2026-11-10T06:00:00.000Z", toIso: "2026-11-11T06:00:00.000Z" });
  });
  it("this week is Monday through Sunday of the account's own week", () => {
    expect(resolveRange({ range: "this_week" }, Z, NOW)).toMatchObject({ firstDay: "2026-11-09", lastDay: "2026-11-15",
      fromIso: "2026-11-09T06:00:00.000Z", toIso: "2026-11-16T06:00:00.000Z", multiDay: true });
  });
  it("fall-back: a named date on the day the clocks changed is 25 hours, from local midnight to local midnight", () => {
    expect(resolveRange({ range: "dates", from: "2026-11-01" }, Z, NOW)).toMatchObject({
      fromIso: "2026-11-01T05:00:00.000Z", toIso: "2026-11-02T06:00:00.000Z" });
  });
  it("spring-forward: 2026-03-08 is 23 hours in Chicago (owner ruling Q-F)", () => {
    expect(resolveRange({ range: "dates", from: "2026-03-08" }, Z, NOW)).toMatchObject({
      fromIso: "2026-03-08T06:00:00.000Z", toIso: "2026-03-09T05:00:00.000Z" });
  });
  it("'today' during the night of a clock change is the account's day, not UTC's (Q-F)", () => {
    // 2026-03-08 04:30Z is 22:30 CST on March 7 in Chicago, while UTC already reads March 8.
    expect(resolveRange({ range: "today" }, Z, new Date("2026-03-08T04:30:00.000Z"))).toMatchObject({ firstDay: "2026-03-07",
      fromIso: "2026-03-07T06:00:00.000Z", toIso: "2026-03-08T06:00:00.000Z" });
  });
  it("a zone whose clocks jump AT midnight: the day starts at the first instant that exists (America/Santiago, 2026-09-06; mutation: return localMidnightInstant unchanged -> 03:00Z, FAILS)", () => {
    // weekly-window.ts:95-98 documents that localMidnightInstant assumes no clock change at midnight. Measured with
    // Node 24.13 ICU on 2026-11-09: it answers 2026-09-06T03:00Z here, which is 23:00 on Sept 5 local; 03:59Z still
    // reads Sept 5 and 04:00Z reads Sept 6. localDayStart corrects it to 04:00Z.
    expect(resolveRange({ range: "dates", from: "2026-09-06" }, "America/Santiago", NOW)).toMatchObject({
      fromIso: "2026-09-06T04:00:00.000Z" });
  });
  it("a zone whose clocks fall back TO midnight (America/Havana, 2026-11-01 01:00 -> 00:00): the day starts at the FIRST midnight, 04:00Z, as 0115's SQL does (Q-F; a pinned VALUE, no probe)", () => {
    // Read with Node's ICU when this case was written: 03:59Z is Oct 31 23:59 GMT-4, 04:00Z is Nov 1 00:00 GMT-4 and
    // 05:00Z is Nov 1 00:00 GMT-5. The day began at the first of the two midnights. In JavaScript the mirror image of
    // SQL holds: localMidnightInstant already lands on this first midnight, so localDayStart's step-back loop is a
    // guard no case can fail (measured 2026-11-09: deleting it leaves this case green), while its forward loop is the
    // one the Santiago case needs. PostgreSQL is the other way round (0115's header).
    expect(resolveRange({ range: "dates", from: "2026-11-01" }, "America/Havana", NOW)).toMatchObject({
      fromIso: "2026-11-01T04:00:00.000Z" });
  });
  it("31 days is allowed; 32 is refused (mutation: > MAX_RANGE_DAYS + 1 -> FAILS)", () => {
    expect(resolveRange({ range: "dates", from: "2026-10-01", to: "2026-10-31" }, Z, NOW).ok).toBe(true);
    expect(resolveRange({ range: "dates", from: "2026-10-01", to: "2026-11-01" }, Z, NOW)).toEqual({ ok: false, error: "range_too_long" });
  });
  it("refuses what is not a range: an unknown word, a backwards span, a date that does not exist", () => {
    expect(resolveRange({ range: "last_year" }, Z, NOW)).toEqual({ ok: false, error: "bad_range" });
    expect(resolveRange({ range: "dates", from: "2026-11-05", to: "2026-11-01" }, Z, NOW)).toEqual({ ok: false, error: "bad_range" });
    expect(resolveRange({ range: "dates", from: "2026-02-30" }, Z, NOW)).toEqual({ ok: false, error: "bad_range" });
  });
});
