import { describe, it, expect } from "vitest";
import { formatDateInZone, formatDateTimeInZone } from "./format";

describe("formatDateInZone", () => {
  it("carries the year, so records years apart cannot render identically", () => {
    // The defect this exists to stop: `formatWhen` (lib/booking/time.ts) emits
    // no year, so an A2P registration recorded in 2025 and one recorded in
    // 2026 both read "Fri, Sep 4". On a field whose whole purpose is telling
    // "filed on Tuesday" from "nobody has touched this since March", that is
    // the one distinction that matters.
    const a = formatDateInZone("2025-09-04T12:00:00Z", "America/Chicago");
    const b = formatDateInZone("2026-09-04T12:00:00Z", "America/Chicago");
    expect(a).toContain("2025");
    expect(b).toContain("2026");
    expect(a).not.toBe(b);
  });

  it("formats in the zone it is given, not the runtime's", () => {
    // 01:00 UTC is still the PREVIOUS day in Chicago. The assertion is only
    // meaningful because the two zones disagree about the date for this
    // instant — a fixture zone equal to the runtime zone could not
    // discriminate, which is the recorded trap for timezone tests here.
    const instant = "2026-09-04T01:00:00Z";
    expect(formatDateInZone(instant, "America/Chicago")).toBe("Sep 3, 2026");
    expect(formatDateInZone(instant, "UTC")).toBe("Sep 4, 2026");
  });

  it("emits no clock — this field's resolution is days, not minutes", () => {
    const s = formatDateInZone("2026-09-04T16:04:00Z", "America/Chicago");
    expect(s).not.toMatch(/\d:\d\d/);
    expect(s).not.toMatch(/AM|PM|CDT|CST/);
  });
});

// D-010: the timeline's own row timestamp and the contacts list's "Created"
// column both rendered through a formatter with no zone parameter at all
// (formatDateTime/formatDate) — the RUNTIME's zone, never the account's.
describe("formatDateTimeInZone", () => {
  it("formats in the zone it is given, not the runtime's (mutation: drop the timeZone option → FAILS)", () => {
    // 01:00 UTC is still 8 PM the PREVIOUS day in Chicago — the two zones
    // disagree about both the day AND the hour for this instant, same
    // discriminating-fixture reasoning as formatDateInZone's own test above.
    const instant = "2026-09-04T01:00:00Z";
    expect(formatDateTimeInZone(instant, "America/Chicago")).toBe("Sep 3, 2026, 8:00 PM");
    expect(formatDateTimeInZone(instant, "UTC")).toBe("Sep 4, 2026, 1:00 AM");
  });

  it("carries the year", () => {
    const a = formatDateTimeInZone("2025-09-04T12:00:00Z", "America/Chicago");
    const b = formatDateTimeInZone("2026-09-04T12:00:00Z", "America/Chicago");
    expect(a).toContain("2025");
    expect(b).toContain("2026");
  });

  it("carries the clock time, unlike the date-only formatDateInZone beside it", () => {
    const s = formatDateTimeInZone("2026-09-04T16:04:00Z", "America/Chicago");
    expect(s).toMatch(/\d{1,2}:\d\d\s*(AM|PM)/);
  });
});
