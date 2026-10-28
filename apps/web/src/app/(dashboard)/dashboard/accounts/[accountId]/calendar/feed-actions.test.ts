import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedToken, feedTokenHash } from "@/lib/booking/feed-token";

/**
 * F-048 part 2: make, replace, turn off and undo the SIGNED-IN person's own calendar link. Every write is keyed
 * by readPersonId(route account, the caller's Clerk id), never by anything the browser sends.
 */

const access = vi.hoisted(() => ({
  state: { userId: "user_clerk_1", isAgency: false, role: "owner" as "owner" | "staff" | "technician" | null, canManage: true },
  calls: [] as unknown[][],
  redirect: null as Error | null,
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async (...a: unknown[]) => {
    access.calls.push(a);
    if (access.redirect) throw access.redirect;
    return { ...access.state };
  },
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const db = vi.hoisted(() => ({
  serviceDb: vi.fn(() => ({ fake: "service" })),
  readPersonId: vi.fn(),
  createCalendarFeed: vi.fn(),
  replaceCalendarFeed: vi.fn(),
  revokeCalendarFeed: vi.fn(),
  restoreCalendarFeed: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => db.serviceDb(),
  readPersonId: (...a: unknown[]) => db.readPersonId(...a),
  createCalendarFeed: (...a: unknown[]) => db.createCalendarFeed(...a),
  replaceCalendarFeed: (...a: unknown[]) => db.replaceCalendarFeed(...a),
  revokeCalendarFeed: (...a: unknown[]) => db.revokeCalendarFeed(...a),
  restoreCalendarFeed: (...a: unknown[]) => db.restoreCalendarFeed(...a),
}));

const { makeFeedLinkAction, replaceFeedLinkAction, turnOffFeedLinkAction, undoFeedLinkAction } = await import("./feed-actions");

const SECRET = "test_calendar_feed_secret_at_least_32_chars_long";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WRITES = [db.createCalendarFeed, db.replaceCalendarFeed, db.revokeCalendarFeed, db.restoreCalendarFeed];

beforeEach(() => {
  vi.stubEnv("CALENDAR_FEED_SECRET", SECRET);
  access.state = { userId: "user_clerk_1", isAgency: false, role: "owner", canManage: true };
  access.calls = [];
  access.redirect = null;
  revalidatePath.mockClear();
  db.serviceDb.mockClear();
  db.readPersonId.mockReset().mockResolvedValue("person_1");
  db.createCalendarFeed.mockReset().mockResolvedValue("ok");
  db.replaceCalendarFeed.mockReset().mockResolvedValue({ status: "ok", previousId: "feed_old", revokedAt: "2026-10-28T12:00:00.123456+00:00" });
  db.revokeCalendarFeed.mockReset().mockResolvedValue({ feedId: "feed_old", revokedAt: "2026-10-28T12:00:00.123456+00:00" });
  db.restoreCalendarFeed.mockReset().mockResolvedValue("restored");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("makeFeedLinkAction", () => {
  it("stores the hash of the token DERIVED from a fresh row id, made by the caller, for the caller's own person (mutation: hash the id instead of the token → FAILS)", async () => {
    expect(await makeFeedLinkAction("acc_route")).toEqual({ ok: true, undo: null });
    expect(db.readPersonId).toHaveBeenCalledWith({ fake: "service" }, "acc_route", "user_clerk_1");
    expect(db.createCalendarFeed).toHaveBeenCalledTimes(1);
    const [client, a] = db.createCalendarFeed.mock.calls[0]! as [unknown, { accountId: string; userId: string; id: string; tokenHash: string; createdBy: string }];
    expect(client).toEqual({ fake: "service" });
    expect(a.id).toMatch(UUID);
    expect(a.tokenHash).toBe(feedTokenHash(feedToken(a.id)));
    expect(a).toMatchObject({ accountId: "acc_route", userId: "person_1", createdBy: "user_clerk_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acc_route/calendar");
  });

  it("the agency gets notMember and nothing is written (owner decision D1)", async () => {
    access.state = { userId: "user_agency", isAgency: true, role: null, canManage: true };
    expect(await makeFeedLinkAction("acc_route")).toEqual({ ok: false, error: "calendar.feed.error.notMember" });
    for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  });

  it("a caller who is not a member of the route's account gets notMember and nothing is written", async () => {
    db.readPersonId.mockResolvedValue(null);
    expect(await makeFeedLinkAction("acc_other")).toEqual({ ok: false, error: "calendar.feed.error.notMember" });
    expect(db.readPersonId).toHaveBeenCalledWith({ fake: "service" }, "acc_other", "user_clerk_1");
    for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  });

  it("a failed write answers failed, logged without the token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.createCalendarFeed.mockRejectedValue(new Error("createCalendarFeed failed: boom"));
    expect(await makeFeedLinkAction("acc_route")).toEqual({ ok: false, error: "calendar.feed.error.failed" });
    const a = db.createCalendarFeed.mock.calls[0]![1] as { id: string };
    expect(log.mock.calls.flat().map(String).join(" ")).not.toContain(feedToken(a.id));
  });
});

describe("replaceFeedLinkAction", () => {
  it("revokes and replaces in one call, and offers the Undo of exactly that replace", async () => {
    const r = await replaceFeedLinkAction("acc_route");
    const a = db.replaceCalendarFeed.mock.calls[0]![1] as { accountId: string; userId: string; newId: string; newHash: string; createdBy: string };
    expect(a.newId).toMatch(UUID);
    expect(a.newHash).toBe(feedTokenHash(feedToken(a.newId)));
    expect(a).toMatchObject({ accountId: "acc_route", userId: "person_1", createdBy: "user_clerk_1" });
    expect(r).toEqual({ ok: true, undo: { feedId: "feed_old", revokedAt: "2026-10-28T12:00:00.123456+00:00", replacementId: a.newId } });
    expect(db.createCalendarFeed).not.toHaveBeenCalled();
  });

  it("with no live link it makes one instead, and offers no Undo", async () => {
    db.replaceCalendarFeed.mockResolvedValue({ status: "none" });
    expect(await replaceFeedLinkAction("acc_route")).toEqual({ ok: true, undo: null });
    const made = db.createCalendarFeed.mock.calls[0]![1] as { id: string; tokenHash: string };
    const asked = db.replaceCalendarFeed.mock.calls[0]![1] as { newId: string };
    expect(made.id).toBe(asked.newId);
    expect(made.tokenHash).toBe(feedTokenHash(feedToken(made.id)));
  });
});

describe("turnOffFeedLinkAction", () => {
  it("revokes the caller's own live link and offers its Undo, with no replacement", async () => {
    expect(await turnOffFeedLinkAction("acc_route")).toEqual({
      ok: true, undo: { feedId: "feed_old", revokedAt: "2026-10-28T12:00:00.123456+00:00", replacementId: null },
    });
    expect(db.revokeCalendarFeed).toHaveBeenCalledWith({ fake: "service" }, "acc_route", "person_1");
  });

  it("nothing to turn off → ok with no Undo", async () => {
    db.revokeCalendarFeed.mockResolvedValue(null);
    expect(await turnOffFeedLinkAction("acc_route")).toEqual({ ok: true, undo: null });
  });

  it("works with no secret: closing a link never needs one", async () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "");
    expect((await turnOffFeedLinkAction("acc_route")).ok).toBe(true);
  });
});

describe("undoFeedLinkAction", () => {
  const undo = { feedId: "feed_old", revokedAt: "2026-10-28T12:00:00.123456+00:00", replacementId: "feed_new" };

  it("restores for the CALLER's own person id from readPersonId, never a value from the payload (mutation: pass undo.feedId as userId → FAILS)", async () => {
    expect(await undoFeedLinkAction("acc_route", undo)).toEqual({ ok: true, undo: null });
    expect(db.restoreCalendarFeed).toHaveBeenCalledWith({ fake: "service" }, {
      accountId: "acc_route", userId: "person_1", feedId: "feed_old", revokedAt: undo.revokedAt, replacementId: "feed_new",
    });
  });

  it("\"changed\" → undoLate", async () => {
    db.restoreCalendarFeed.mockResolvedValue("changed");
    expect(await undoFeedLinkAction("acc_route", undo)).toEqual({ ok: false, error: "calendar.feed.error.undoLate" });
  });

  it("the agency gets notMember and nothing is restored", async () => {
    access.state = { userId: "user_agency", isAgency: true, role: null, canManage: true };
    expect(await undoFeedLinkAction("acc_route", undo)).toEqual({ ok: false, error: "calendar.feed.error.notMember" });
    expect(db.restoreCalendarFeed).not.toHaveBeenCalled();
  });
});

describe("the secret (owner decision D2)", () => {
  it.each([["make", () => makeFeedLinkAction("acc_route")], ["replace", () => replaceFeedLinkAction("acc_route")]] as const)(
    "%s answers unavailable when the secret is unset, with no write",
    async (_n, run) => {
      vi.stubEnv("CALENDAR_FEED_SECRET", "");
      expect(await run()).toEqual({ ok: false, error: "calendar.feed.error.unavailable" });
      for (const w of WRITES) expect(w).not.toHaveBeenCalled();
    },
  );
});

describe("a billing pause (review I3)", () => {
  it("turn off, replace and undo pass { duringPause: \"allow\" }; make passes no option (mutation: drop the option from turnOffFeedLinkAction → FAILS)", async () => {
    const undo = { feedId: "feed_old", revokedAt: "2026-10-28T12:00:00.123456+00:00", replacementId: null };
    for (const [name, run] of [
      ["turnOff", () => turnOffFeedLinkAction("acc_route")],
      ["replace", () => replaceFeedLinkAction("acc_route")],
      ["undo", () => undoFeedLinkAction("acc_route", undo)],
    ] as const) {
      access.calls = [];
      await run();
      expect(access.calls, name).toEqual([["acc_route", { duringPause: "allow" }]]);
    }
    access.calls = [];
    await makeFeedLinkAction("acc_route");
    expect(access.calls).toEqual([["acc_route"]]);
  });

  it("none of the three protective actions revalidates (the card refreshes instead)", async () => {
    await turnOffFeedLinkAction("acc_route");
    await replaceFeedLinkAction("acc_route");
    await undoFeedLinkAction("acc_route", { feedId: "f", revokedAt: "t", replacementId: null });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the guard's redirect is never swallowed", () => {
  it.each([
    ["make", () => makeFeedLinkAction("acc_route")],
    ["replace", () => replaceFeedLinkAction("acc_route")],
    ["turnOff", () => turnOffFeedLinkAction("acc_route")],
    ["undo", () => undoFeedLinkAction("acc_route", { feedId: "f", revokedAt: "t", replacementId: null })],
  ] as const)("%s: a redirect from requireAccountAccess (paused, signed out) propagates instead of reading as \"didn't save\" (mutation: call the guard inside the try → FAILS)", async (_n, run) => {
    access.redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" });
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  });
});
