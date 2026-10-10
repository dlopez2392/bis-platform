import { describe, it, expect, vi } from "vitest";
import { formatCurrency, formatDateInZone, formatDateTimeInZone, formatRelativeTime } from "./format";

// `vi.spyOn`'s default call-through does not preserve a native Intl
// constructor's internal slots (observed on Vitest 4.1.10 / Node v24.13.0
// here: `new Intl.NumberFormat(...)` under a bare `vi.spyOn(Intl,
// "NumberFormat")` returns an object with no `.format` method — vitest
// itself warns "did not use 'function' or 'class' in its implementation").
// This helper restores real construction via a saved original reference so
// the spy still records call args without breaking the formatter it wraps.
function spyOnCtor<K extends "NumberFormat" | "DateTimeFormat">(key: K) {
  const Original = Intl[key];
  return vi.spyOn(Intl, key).mockImplementation(function (
    this: unknown,
    ...args: unknown[]
  ) {
    return new (Original as new (...a: unknown[]) => unknown)(...args);
  } as never);
}

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

// F-013 part 1: an optional trailing `locale` parameter on every formatter,
// defaulting to "en" so every existing call site above (and every other
// caller in the repo) keeps its exact current output.
describe("formatCurrency", () => {
  it("stays USD in both locales, only the Intl locale tag changes (mutation: use es-MX instead of es-US → this still passes for 1234, so the real guard is the locale-tag assertion below, not the output string alone)", () => {
    expect(formatCurrency(1234)).toBe(formatCurrency(1234, "en"));
    // es-US groups identically to en-US (both use "," thousands/"." decimal) —
    // the two calls below must therefore produce the SAME digits, so a
    // regression to es-MX (which also does) would NOT be caught by string
    // equality. The real assertion is on the Intl call itself:
    const spy = spyOnCtor("NumberFormat");
    formatCurrency(1234, "es");
    expect(spy.mock.calls.at(-1)?.[0]).toBe("es-US");
    spy.mockRestore();
  });
});

describe("formatDateInZone locale", () => {
  it("passes the es-US locale tag through to Intl.DateTimeFormat (mutation: hard-code en-US regardless of the locale param → FAILS)", () => {
    const spy = spyOnCtor("DateTimeFormat");
    formatDateInZone("2026-10-10T12:00:00Z", "America/Chicago", "es");
    expect(spy.mock.calls.at(-1)?.[0]).toBe("es-US");
    spy.mockRestore();
  });
});

describe("formatRelativeTime", () => {
  it("renders a past instant in Spanish when asked (mutation: ignore the locale param → FAILS, stays 'ago')", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo, "es")).not.toMatch(/ago/i);
  });

  it("defaults to English when no locale is given (mutation: default the param to \"es\" → FAILS)", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toMatch(/ago/i);
  });
});
