import { describe, it, expect } from "vitest";
import { tomorrowAt9 } from "./dismiss-date";

describe("tomorrowAt9", () => {
  it("is 09:00 the next day in the ACCOUNT's zone, not the server's — one instant, two zones, opposite verdicts", () => {
    // This machine's own system zone is America/Chicago, so a fixture that
    // only ever exercises Chicago cannot tell a real zone-aware read from a
    // plain system-zone one wearing a zone parameter it never looks at. Pin
    // it with a SECOND zone on the SAME instant that disagrees on both the
    // calendar day and the offset, so no fixed or ambient zone can satisfy
    // both assertions at once.
    const now = new Date("2026-09-15T02:00:00Z");
    // At this instant Chicago (CDT, UTC-5) is still Sep 14, 21:00 — "today"
    // is the 14th, so tomorrow 09:00 CDT is the 15th at 14:00Z.
    expect(tomorrowAt9(now, "America/Chicago")).toBe("2026-09-15T14:00:00.000Z");
    // At the SAME instant Tokyo (UTC+9) is already Sep 15, 11:00 — "today"
    // is the 15th, so tomorrow 09:00 JST is the 16th at 00:00Z. A different
    // calendar day AND a different offset than the Chicago case above: a
    // read that silently used the system zone (Chicago) here would return
    // the Chicago answer instead, and this assertion is what catches that.
    expect(tomorrowAt9(now, "Asia/Tokyo")).toBe("2026-09-16T00:00:00.000Z");
  });

  it("crosses a DST boundary without drifting an hour", () => {
    // US DST ends 2026-11-01 at 2am local (CDT UTC-5 -> CST UTC-6).
    // 2026-10-31T13:00Z is 08:00 CDT; tomorrow 09:00 is already CST, = 15:00Z,
    // not a flat +24h (which would land on 14:00Z and silently drift an hour).
    const iso = tomorrowAt9(new Date("2026-10-31T13:00:00Z"), "America/Chicago");
    expect(iso).toBe("2026-11-01T15:00:00.000Z");
  });

  it("degrades to null (never a guess) when the zone is unusable", () => {
    // "Not/AZone" is not a real IANA zone — reachable today via the
    // free-text timezone input at create-account-dialog.tsx:80, passed
    // through unchecked. Guessing a moment in a zone we can't resolve is
    // worse than creating the task with no due date at all (spec: the
    // milestone already removed a UTC fallback for exactly this reason).
    expect(tomorrowAt9(new Date("2026-09-14T14:00:00Z"), "Not/AZone")).toBeNull();
  });

  it("degrades to null rather than falling through to the server's zone when zone is undefined", () => {
    // `Intl.DateTimeFormat`'s own `timeZone: undefined` does not throw — it
    // silently resolves the RUNTIME's zone, which is exactly the kind of
    // substitution this helper's contract forbids. Not reachable through
    // today's schema (the column is non-null with a default), but a caller
    // mistake or a future nullable column must not silently borrow the
    // server's zone the same way a missing `dueAt` must not silently borrow
    // a guessed instant.
    expect(tomorrowAt9(new Date("2026-09-14T14:00:00Z"), undefined as unknown as string)).toBeNull();
  });
});
