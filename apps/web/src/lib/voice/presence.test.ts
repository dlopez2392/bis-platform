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

  // D-075: "this week" is measured in the ACCOUNT's own zone, not UTC — the
  // same Monday-start convention `lib/reports/weekly-window.ts` already uses
  // for the Monday report (re-derived here via its own exported
  // `lastWeekMonday`/`weekWindow`, never a second hand-rolled day-shift that
  // could drift from that module's DST-safe arithmetic). A client in
  // America/Chicago whose week starts Monday LOCAL time must not see the
  // topbar roll over at 00:00 UTC — 19:00 the evening before, in Chicago's
  // summer offset.
  describe("account-zone week boundary (Monday 00:00:00 LOCAL)", () => {
    it("Chicago (CDT, UTC-5): UTC has already rolled into Monday but it's still Sunday night locally — the week must NOT have turned over yet (mutation: use the UTC boundary → FAILS, asserts the already-rolled-over UTC Monday instead)", async () => {
      // 2027-06-07T02:00:00Z = 2027-06-06 21:00 CDT — Sunday night in
      // Chicago, even though the UTC calendar date is already Monday
      // June 7. A UTC-boundary implementation would treat this instant as
      // the start of the NEW week; the account's own clock says the old
      // week (started Monday May 31) hasn't ended yet.
      const now = new Date("2027-06-07T02:00:00.000Z");
      await getVoicePresence(db, "acct1", now, "America/Chicago");
      // Last week's Monday, midnight CDT = 2027-05-31T05:00:00Z — five hours
      // LATER than the UTC-only test below asserts for the same calendar
      // Monday, because Chicago's midnight lands five hours after UTC's.
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-05-31T05:00:00.000Z", now.toISOString(),
      );
    });

    it("Chicago: Thursday mid-week resolves to THIS week's Monday midnight local, not last week's", async () => {
      const now = new Date("2027-06-03T18:00:00.000Z"); // Thu 13:00 CDT
      await getVoicePresence(db, "acct1", now, "America/Chicago");
      // Monday 2027-05-31 midnight CDT = 2027-05-31T05:00:00Z.
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-05-31T05:00:00.000Z", now.toISOString(),
      );
    });

    it("a UTC account still rolls over at UTC midnight Monday — the zone drives the boundary, not a second hard-coded path", async () => {
      const now = new Date("2027-06-03T12:34:56.000Z"); // Thursday
      await getVoicePresence(db, "acct1", now, "UTC");
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-05-31T00:00:00.000Z", now.toISOString(),
      );
    });

    // Spring-forward week: 2027-03-14 is the US DST jump (America/Chicago
    // CST → CDT at 02:00 local). The week Monday 2027-03-08 through Sunday
    // 2027-03-14 is 167 real hours, not 168 — adding `7 * 24 * 3600_000` ms
    // to that Monday's local midnight lands ONE HOUR into the wrong side of
    // the jump (2027-03-15T06:00:00.000Z) instead of the real local midnight
    // of the following Monday (2027-03-15T05:00:00.000Z, now CDT). This
    // proves `getVoicePresence` re-derives the boundary through
    // `weekly-window.ts`'s own zone-correct instant resolution
    // (`lastWeekMonday`/`weekWindow`) rather than any ms-arithmetic shortcut
    // (mutation: replace the boundary with `now - 7*24*3600_000` → FAILS,
    // off by exactly one hour).
    it("a week spanning the US spring-forward jump still resolves to the REAL local midnight, not a 168-hour ms shortcut", async () => {
      const now = new Date("2027-03-18T18:00:00.000Z"); // Thu 13:00 CDT, inside the week right after the jump
      await getVoicePresence(db, "acct1", now, "America/Chicago");
      expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
        db, "acct1", "2027-03-15T05:00:00.000Z", now.toISOString(),
      );
    });
  });
});
