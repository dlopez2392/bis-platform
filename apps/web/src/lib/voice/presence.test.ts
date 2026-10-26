// apps/web/src/lib/voice/presence.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// House pattern (registry.test.ts): mock the specific @bis/db reads this
// module calls rather than faking a chainable supabase client — the two
// reads it delegates to (hasActiveCallSince here; the answered-calls read in weekly-metrics.test.ts) are already
// unit-proven against a live DB in packages/db/src/test/voice.test.ts, so
// this file only needs to prove getVoicePresence WIRES them correctly
// (right args, right combination), not re-prove the SQL underneath.
const dbMocks = vi.hoisted(() => ({
  hasActiveCallSince: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, ...dbMocks };
});
// weekCount reads the Monday report's answered-calls helper (2026-10-06), so
// "handled" means what the report's "calls answered" means. Its own suite
// (weekly-metrics.test.ts) pins the outcome set and the handset exclusion.
const reportMocks = vi.hoisted(() => ({ listAnsweredCallStartsBetween: vi.fn() }));
vi.mock("@/lib/reports/weekly-metrics", () => ({
  listAnsweredCallStartsBetween: (...a: unknown[]) => reportMocks.listAnsweredCallStartsBetween(...a),
}));

import type { serviceDb } from "@bis/db";
import { getVoicePresence } from "./presence";

// Never dereferenced — every read this module makes goes through the mocked
// @bis/db functions above, same as registry.test.ts's own empty-object ctx.db.
const db = {} as unknown as ReturnType<typeof serviceDb>;

beforeEach(() => {
  reportMocks.listAnsweredCallStartsBetween.mockReset().mockResolvedValue([]);
  dbMocks.hasActiveCallSince.mockReset().mockResolvedValue(false);
});

describe("getVoicePresence", () => {
  it("onCall true: hasActiveCallSince is called with a floor exactly one hour before `now`", async () => {
    dbMocks.hasActiveCallSince.mockResolvedValue(true);
    const now = new Date("2027-06-03T12:00:00.000Z");
    const { onCall } = await getVoicePresence(db, "acct1", now, "UTC");
    expect(onCall).toBe(true);
    expect(dbMocks.hasActiveCallSince).toHaveBeenCalledWith(db, "acct1", "2027-06-03T11:00:00.000Z");
  });

  it("onCall false: passed straight through when nothing is active", async () => {
    dbMocks.hasActiveCallSince.mockResolvedValue(false);
    const { onCall } = await getVoicePresence(db, "acct1", new Date("2027-06-03T12:00:00.000Z"), "UTC");
    expect(onCall).toBe(false);
  });

  it("weekCount is the number of ANSWERED calls, not every call row", async () => {
    reportMocks.listAnsweredCallStartsBetween.mockResolvedValue(["a", "b", "c", "d", "e", "f", "g"]);
    const { weekCount } = await getVoicePresence(db, "acct1", new Date("2027-06-03T12:00:00.000Z"), "UTC");
    expect(weekCount).toBe(7);
  });

  it("both reads are scoped to the given accountId, never a hardcoded one", async () => {
    await getVoicePresence(db, "acct-xyz", new Date("2027-06-03T12:00:00.000Z"), "UTC");
    expect(dbMocks.hasActiveCallSince).toHaveBeenCalledWith(db, "acct-xyz", expect.any(String));
    expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(db, "acct-xyz", expect.any(String), expect.any(String));
  });

  // The count is the last 7 LOCAL days, today included, in the ACCOUNT's own
  // zone (D-075) — the dashboard's "Calls answered" window (`localDayWindow`,
  // page.tsx's `window7`), so the topbar and that tile always agree. Until
  // 2026-10-26 it was the calendar week from Monday 00:00 local, which read
  // "✓ 0 calls handled this week" every Monday morning.
  describe("the last 7 local days, as the dashboard counts them", () => {
    it("Monday morning in Chicago reaches back to LAST Tuesday's local midnight, not this Monday's (mutation: count from Monday 00:00 -> FAILS)", async () => {
      const now = new Date("2027-06-07T14:00:00.000Z"); // Mon 09:00 CDT
      await getVoicePresence(db, "acct1", now, "America/Chicago");
      // Tue 2027-06-01 00:00 CDT = 05:00Z; Jun 1..Jun 7 is seven local days.
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-06-01T05:00:00.000Z", now.toISOString(),
      );
    });

    it("the window is the account's local days, not UTC's (mutation: use UTC -> FAILS)", async () => {
      // 2027-06-07T02:00Z is Sunday 21:00 in Chicago: today is Jun 6 locally.
      const now = new Date("2027-06-07T02:00:00.000Z");
      await getVoicePresence(db, "acct1", now, "America/Chicago");
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-05-31T05:00:00.000Z", now.toISOString(),
      );
    });

    it("a UTC account counts from UTC midnight six days back", async () => {
      const now = new Date("2027-06-03T12:34:56.000Z");
      await getVoicePresence(db, "acct1", now, "UTC");
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-05-28T00:00:00.000Z", now.toISOString(),
      );
    });

    it("across the spring-forward jump the first day starts at ITS OWN local midnight (CST), not now minus 168 hours (mutation: ms arithmetic -> FAILS)", async () => {
      const now = new Date("2027-03-15T15:00:00.000Z"); // Mon 10:00 CDT
      await getVoicePresence(db, "acct1", now, "America/Chicago");
      // Tue 2027-03-09 00:00 CST = 06:00Z.
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-03-09T06:00:00.000Z", now.toISOString(),
      );
    });
  });
});
