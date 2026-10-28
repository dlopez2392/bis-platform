import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedToken, feedTokenHash } from "@/lib/booking/feed-token";

/**
 * F-048 part 2: the "Bookings on your phone" card's server read. Every read is keyed by the ROUTE's account and
 * the caller's own person id, so a person sees their own link and nobody else's; a failed read is the card's
 * own error state, never the page's.
 */

const db = vi.hoisted(() => ({
  serviceDb: vi.fn(() => ({ fake: "service" })),
  readPersonId: vi.fn(),
  readLiveCalendarFeed: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => db.serviceDb(),
  readPersonId: (...a: unknown[]) => db.readPersonId(...a),
  readLiveCalendarFeed: (...a: unknown[]) => db.readLiveCalendarFeed(...a),
}));

const { loadFeedCardView } = await import("./feed-card-data");

const SECRET = "test_calendar_feed_secret_at_least_32_chars_long";
const ORIGIN = "https://app.bis-rgv.com";
const FEED_ID = "6f1c2c1e-3b7a-4c51-9a55-0c7d7f3b2a10";
const base = { accountId: "acc_route", clerkUserId: "user_clerk_1", isAgency: false, role: "owner" as const, origin: ORIGIN };
const row = (over: Record<string, unknown> = {}) => ({
  id: FEED_ID, account_id: "acc_route", user_id: "person_1", token_hash: feedTokenHash(feedToken(FEED_ID)),
  created_at: "2026-10-28T10:00:00.000Z", revoked_at: null, last_fetched_at: "2026-10-28T11:00:00.000Z", ...over,
});

beforeEach(() => {
  vi.stubEnv("CALENDAR_FEED_SECRET", SECRET);
  db.serviceDb.mockClear();
  db.readPersonId.mockReset().mockResolvedValue("person_1");
  db.readLiveCalendarFeed.mockReset().mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("loadFeedCardView (F-048 part 2)", () => {
  it("the agency gets the agency state and nothing is read (owner decision D1: the agency has no link)", async () => {
    expect(await loadFeedCardView({ ...base, isAgency: true, role: null })).toEqual({ kind: "agency" });
    expect(db.readPersonId).not.toHaveBeenCalled();
    expect(db.readLiveCalendarFeed).not.toHaveBeenCalled();
  });

  it("with no secret the card says it is unavailable, and reads nothing (owner decision D2: no fallback)", async () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "");
    expect(await loadFeedCardView(base)).toEqual({ kind: "unavailable" });
    expect(db.readLiveCalendarFeed).not.toHaveBeenCalled();
  });

  it("second account: the person is looked up in the ROUTE's account, and a non-member never reaches the feed read (mutation: skip the member check → FAILS)", async () => {
    db.readPersonId.mockResolvedValue(null);
    expect(await loadFeedCardView({ ...base, accountId: "acc_other" })).toEqual({ kind: "error" });
    expect(db.readPersonId).toHaveBeenCalledWith({ fake: "service" }, "acc_other", "user_clerk_1");
    expect(db.readLiveCalendarFeed).not.toHaveBeenCalled();
  });

  it("the feed is read for the caller's own person id in the route's account", async () => {
    await loadFeedCardView(base);
    expect(db.readLiveCalendarFeed).toHaveBeenCalledWith({ fake: "service" }, "acc_route", "person_1");
  });

  it("no live row → none", async () => {
    expect(await loadFeedCardView(base)).toEqual({ kind: "none" });
  });

  it("a row whose hash matches the derived token → live, with the https link, its webcal twin and the last fetch", async () => {
    db.readLiveCalendarFeed.mockResolvedValue(row());
    const token = feedToken(FEED_ID);
    expect(await loadFeedCardView(base)).toEqual({
      kind: "live", url: `https://app.bis-rgv.com/cal/${token}.ics`, webcal: `webcal://app.bis-rgv.com/cal/${token}.ics`,
      lastFetchedAt: "2026-10-28T11:00:00.000Z", technician: false,
    });
  });

  it.each([["technician", true], ["staff", false], ["owner", false]] as const)(
    "role %s → technician %s (the Technician line appears only for a Technician)",
    async (role, technician) => {
      db.readLiveCalendarFeed.mockResolvedValue(row());
      const v = await loadFeedCardView({ ...base, role });
      expect(v.kind === "live" && v.technician).toBe(technician);
    },
  );

  it("a row whose hash does not match (the secret changed) → stale (mutation: drop the hash comparison → FAILS)", async () => {
    db.readLiveCalendarFeed.mockResolvedValue(row({ token_hash: feedTokenHash("some-other-token") }));
    expect(await loadFeedCardView(base)).toEqual({ kind: "stale" });
  });

  it("a failed read → error, logged without the token (DESIGN.md rule 5: the card's own error state)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readLiveCalendarFeed.mockRejectedValue(new Error("readLiveCalendarFeed failed: boom"));
    expect(await loadFeedCardView(base)).toEqual({ kind: "error" });
    expect(log).toHaveBeenCalledTimes(1);
    const logged = log.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("boom");
    expect(logged).not.toContain(feedToken(FEED_ID));
  });
});
