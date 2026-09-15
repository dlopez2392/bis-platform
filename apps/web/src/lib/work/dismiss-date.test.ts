import { describe, it, expect } from "vitest";
import { tomorrowAt9 } from "./dismiss-date";

describe("tomorrowAt9", () => {
  it("is 09:00 the next day in the ACCOUNT's zone, not the server's", () => {
    // 2026-09-14T14:00Z is 09:00 Chicago. Tomorrow 09:00 Chicago = 14:00Z on the 15th.
    const iso = tomorrowAt9(new Date("2026-09-14T14:00:00Z"), "America/Chicago");
    expect(iso).toBe("2026-09-15T14:00:00.000Z");
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
});
