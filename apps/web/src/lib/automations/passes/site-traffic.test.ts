import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SiteRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listSitesToSync: vi.fn(), writeTrafficDay: vi.fn(), stampSiteSynced: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

const vercelMocks = vi.hoisted(() => ({ fromEnv: vi.fn(), fetchDayTraffic: vi.fn() }));
vi.mock("@/lib/vercel/web-analytics", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  vercelAnalyticsFromEnv: () => vercelMocks.fromEnv(),
}));

import { AUTOMATION_TICK_CAP } from "../caps";
import type { PassContext } from "../context";
import { siteTrafficPass } from "./site-traffic";

// 2026-09-07T09:30Z: 04:30 in Chicago (past 03:00), 02:30 in Los Angeles (not yet).
const TICK = new Date("2026-09-07T09:30:00.000Z");

function site(overrides: Partial<SiteRow & { accountTimezone: string }> = {}): SiteRow & { accountTimezone: string } {
  return {
    id: "site_1", accountId: "acct_1", vercelProjectId: "prj_1", domain: "rio.example",
    analyticsEnabledAt: "2026-08-01T00:00:00.000Z", lastSyncedDay: "2026-09-04",
    accountTimezone: "America/Chicago", ...overrides,
  };
}
const DAY = { visitors: 10, pageviews: 20, pages: [{ value: "/", visitors: 10, pageviews: 20 }],
  sources: [{ value: "google.com", visitors: 6, pageviews: 12 }], places: [{ value: "US", visitors: 9, pageviews: 18 }],
  devices: [{ value: "mobile", visitors: 7, pageviews: 14 }] };
const ctx = (): PassContext => ({
  db: {} as never, now: TICK, origin: "https://app.example.com",
  email: { isFake: true, send: vi.fn() }, sms: () => ({ isFake: true, send: vi.fn() }),
});
const EMPTY = { synced: 0, daysSynced: 0, failed: 0, skippedNotYet: 0, skippedUpToDate: 0, skippedCap: 0, unresolvableTimezone: 0 };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  vercelMocks.fromEnv.mockReset();
  vercelMocks.fetchDayTraffic.mockReset();
  vercelMocks.fromEnv.mockReturnValue({ fetchDayTraffic: (...a: unknown[]) => vercelMocks.fetchDayTraffic(...a) });
  vercelMocks.fetchDayTraffic.mockResolvedValue(DAY);
  dbMocks.writeTrafficDay.mockResolvedValue(undefined);
  dbMocks.stampSiteSynced.mockResolvedValue(undefined);
  dbMocks.listSitesToSync.mockResolvedValue([]);
});

describe("siteTrafficPass", () => {
  it("has the key the cron reports under, and does nothing with no sites", async () => {
    expect(siteTrafficPass.key).toBe("siteTraffic");
    expect(await siteTrafficPass.run(ctx())).toEqual(EMPTY);
    expect(vercelMocks.fromEnv).not.toHaveBeenCalled();
  });

  // Mutation: drop the isPastSyncHour check — this site is pulled at 02:30 local.
  it("waits until 03:00 in the account's zone — Los Angeles is not there yet", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ accountTimezone: "America/Los_Angeles" })]);
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, skippedNotYet: 1 });
    expect(vercelMocks.fetchDayTraffic).not.toHaveBeenCalled();
  });

  it("skips a site whose yesterday is already stored, without constructing the client", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ lastSyncedDay: "2026-09-06" })]);
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, skippedUpToDate: 1 });
    expect(vercelMocks.fromEnv).not.toHaveBeenCalled();
  });

  // Mutation: stamp BEFORE write in the pass — the order assertion fails.
  it("pulls the missing days oldest-first with local-day bounds, writes, then stamps each day", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site()]);   // last synced 09-04 → 09-05, 09-06 due
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, synced: 1, daysSynced: 2 });
    expect(vercelMocks.fetchDayTraffic.mock.calls).toEqual([
      ["prj_1", "2026-09-05T05:00:00.000Z", "2026-09-06T05:00:00.000Z"],
      ["prj_1", "2026-09-06T05:00:00.000Z", "2026-09-07T05:00:00.000Z"],
    ]);
    expect(dbMocks.writeTrafficDay.mock.calls[0]![2]).toBe("2026-09-05");
    expect(dbMocks.writeTrafficDay.mock.calls[0]![3]).toEqual({ visitors: 10, pageviews: 20 });
    expect(dbMocks.writeTrafficDay.mock.calls[0]![4]).toEqual([
      { dimension: "page", value: "/", visitors: 10, pageviews: 20 },
      { dimension: "source", value: "google.com", visitors: 6, pageviews: 12 },
      { dimension: "place", value: "US", visitors: 9, pageviews: 18 },
      { dimension: "device", value: "mobile", visitors: 7, pageviews: 14 },
    ]);
    expect(dbMocks.stampSiteSynced.mock.calls.map((c) => c[2])).toEqual(["2026-09-05", "2026-09-06"]);
    expect(dbMocks.writeTrafficDay.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.stampSiteSynced.mock.invocationCallOrder[0]!);
  });

  // Mutation: wrap each day in its own try (continue past a failed day) —
  // the second day is written after the first failed, leaving a hole.
  it("stops at the first failed day so no hole is left behind a success; the site counts failed", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site()]);
    vercelMocks.fetchDayTraffic.mockRejectedValueOnce(new Error("429 rate limited"));
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(vercelMocks.fetchDayTraffic).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampSiteSynced).not.toHaveBeenCalled();
  });

  it("one site's failure never touches the next site", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site(), site({ id: "site_2", accountId: "acct_2", vercelProjectId: "prj_2", lastSyncedDay: "2026-09-05" })]);
    vercelMocks.fetchDayTraffic.mockRejectedValueOnce(new Error("boom"));
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, failed: 1, synced: 1, daysSynced: 1 });
    expect(dbMocks.stampSiteSynced.mock.calls.map((c) => [c[1], c[2]])).toEqual([["site_2", "2026-09-06"]]);
  });

  // Mutation: construct the client at the top of run() — the throw becomes
  // an outright pass rejection instead of one failed site.
  it("a missing token fails only the sites that needed a pull, loudly, and never throws outright", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ lastSyncedDay: "2026-09-06" }), site({ id: "site_2", accountId: "acct_2" })]);
    vercelMocks.fromEnv.mockImplementation(() => { throw new Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset"); });
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, skippedUpToDate: 1, failed: 1 });
  });

  it("caps the sites pulled per tick at AUTOMATION_TICK_CAP; the rest are simply due next tick", async () => {
    const many = Array.from({ length: AUTOMATION_TICK_CAP + 2 }, (_, i) => site({ id: `site_${i}`, accountId: `acct_${i}`, vercelProjectId: `prj_${i}` }));
    dbMocks.listSitesToSync.mockResolvedValue(many);
    const c = await siteTrafficPass.run(ctx());
    expect(c.synced).toBe(AUTOMATION_TICK_CAP);
    expect(c.skippedCap).toBe(2);
  });

  it("holds a site whose account timezone cannot be resolved, and says so", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ accountTimezone: "Mars/Olympus" })]);
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
  });
});
