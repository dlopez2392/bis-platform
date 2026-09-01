// apps/web/src/lib/voice/presence.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// House pattern (registry.test.ts): mock the specific @bis/db reads this
// module calls rather than faking a chainable supabase client — the two
// reads it delegates to (countCallsSince, hasActiveCallSince) are already
// unit-proven against a live DB in packages/db/src/test/voice.test.ts, so
// this file only needs to prove getVoicePresence WIRES them correctly
// (right args, right combination), not re-prove the SQL underneath.
const dbMocks = vi.hoisted(() => ({
  countCallsSince: vi.fn(),
  hasActiveCallSince: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, ...dbMocks };
});

import type { serviceDb } from "@bis/db";
import { getVoicePresence } from "./presence";

// Never dereferenced — every read this module makes goes through the mocked
// @bis/db functions above, same as registry.test.ts's own empty-object ctx.db.
const db = {} as unknown as ReturnType<typeof serviceDb>;

beforeEach(() => {
  dbMocks.countCallsSince.mockReset().mockResolvedValue(0);
  dbMocks.hasActiveCallSince.mockReset().mockResolvedValue(false);
});

describe("getVoicePresence", () => {
  it("onCall true: hasActiveCallSince is called with a floor exactly one hour before `now`", async () => {
    dbMocks.hasActiveCallSince.mockResolvedValue(true);
    const now = new Date("2027-06-03T12:00:00.000Z");
    const { onCall } = await getVoicePresence(db, "acct1", now);
    expect(onCall).toBe(true);
    expect(dbMocks.hasActiveCallSince).toHaveBeenCalledWith(db, "acct1", "2027-06-03T11:00:00.000Z");
  });

  it("onCall false: passed straight through when nothing is active", async () => {
    dbMocks.hasActiveCallSince.mockResolvedValue(false);
    const { onCall } = await getVoicePresence(db, "acct1", new Date("2027-06-03T12:00:00.000Z"));
    expect(onCall).toBe(false);
  });

  it("weekCount comes straight from countCallsSince's answer", async () => {
    dbMocks.countCallsSince.mockResolvedValue(7);
    const { weekCount } = await getVoicePresence(db, "acct1", new Date("2027-06-03T12:00:00.000Z"));
    expect(weekCount).toBe(7);
  });

  it("both reads are scoped to the given accountId, never a hardcoded one", async () => {
    await getVoicePresence(db, "acct-xyz", new Date("2027-06-03T12:00:00.000Z"));
    expect(dbMocks.hasActiveCallSince).toHaveBeenCalledWith(db, "acct-xyz", expect.any(String));
    expect(dbMocks.countCallsSince).toHaveBeenCalledWith(db, "acct-xyz", expect.any(String));
  });

  // "Start of current week" convention, pinned: UTC, ISO-8601 (Monday
  // 00:00:00 UTC starts the week) — there is no pre-existing week-boundary
  // helper anywhere in this tree to match (checked: booking-page.tsx's own
  // `weekStart` is a rolling 7-day window from "today", not a calendar-week
  // convention), so this is a fresh choice. Pinned here rather than left to
  // drift silently — a future change to Sunday-start (or account-tz-aware)
  // must edit this test on purpose, not discover it broke something.
  describe("UTC week boundary (ISO-8601, Monday 00:00:00 UTC)", () => {
    it("Thursday mid-week: since = the Monday just passed, at UTC midnight", async () => {
      const now = new Date("2027-06-03T12:34:56.000Z"); // Thursday, June 3 2027
      await getVoicePresence(db, "acct1", now);
      expect(dbMocks.countCallsSince).toHaveBeenCalledWith(db, "acct1", "2027-05-31T00:00:00.000Z");
    });

    it("exactly Monday 00:00:00 UTC: since = itself, unmoved", async () => {
      const now = new Date("2027-05-31T00:00:00.000Z"); // Monday
      await getVoicePresence(db, "acct1", now);
      expect(dbMocks.countCallsSince).toHaveBeenCalledWith(db, "acct1", "2027-05-31T00:00:00.000Z");
    });

    it("Sunday, the LAST day of the ISO week: still resolves to the Monday before it, not the week ahead", async () => {
      const now = new Date("2027-06-06T23:59:59.000Z"); // Sunday, June 6 2027
      await getVoicePresence(db, "acct1", now);
      expect(dbMocks.countCallsSince).toHaveBeenCalledWith(db, "acct1", "2027-05-31T00:00:00.000Z");
    });

    it("the following Monday rolls the boundary forward exactly one week", async () => {
      const now = new Date("2027-06-07T00:00:00.000Z"); // next Monday
      await getVoicePresence(db, "acct1", now);
      expect(dbMocks.countCallsSince).toHaveBeenCalledWith(db, "acct1", "2027-06-07T00:00:00.000Z");
    });
  });
});
