import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ getSiteForAccount: vi.fn(), listTrafficDays: vi.fn(), listTrafficBreakdown: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { loadWebsiteState } from "./load";

const NOW = new Date("2026-09-07T15:00:00.000Z");   // 10:00 Chicago
/** Projection-filtered accounts stub: yields only the columns the loader's
 *  own select asks for, so a test can only pass if it asked for timezone. */
function db(row: Record<string, unknown> = { timezone: "America/Chicago", name: "Rio — trial" }) {
  return {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table !== "accounts") throw new Error(`unexpected table ${table}`);
            const wanted = cols.split(",").map((c) => c.trim());
            return { data: Object.fromEntries(Object.entries(row).filter(([k]) => wanted.includes(k))), error: null };
          },
        }),
      }),
    }),
  } as never;
}
const SITE = { id: "site_1", accountId: "acct_1", vercelProjectId: "prj_1", domain: "rio.example", analyticsEnabledAt: null, lastSyncedDay: "2026-09-06" };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listTrafficDays.mockResolvedValue([]);
  dbMocks.listTrafficBreakdown.mockResolvedValue([]);
});

describe("loadWebsiteState", () => {
  it("unlinked when the account has no site, without reading traffic", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(null);
    expect(await loadWebsiteState(db(), "acct_1", 14, NOW)).toEqual({ state: "unlinked" });
    expect(dbMocks.listTrafficDays).not.toHaveBeenCalled();
  });
  it("waiting when a site is linked but has never synced", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue({ ...SITE, lastSyncedDay: null });
    expect(await loadWebsiteState(db(), "acct_1", 14, NOW)).toEqual({ state: "waiting", domain: "rio.example" });
  });
  // Mutation: request only the current window (fromDay = current[0]) — the
  // range assertion fails because the prior window is what the deltas need.
  it("ready: reads BOTH windows (2 × period, ending local yesterday) in the account's zone and builds the view", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(SITE);
    dbMocks.listTrafficDays.mockResolvedValue([{ day: "2026-09-06", visitors: 25, pageviews: 40 }]);
    const r = await loadWebsiteState(db(), "acct_1", 7, NOW);
    expect(r.state).toBe("ready");
    expect(dbMocks.listTrafficDays).toHaveBeenCalledWith(expect.anything(), "acct_1", "2026-08-24", "2026-09-06");
    expect(dbMocks.listTrafficBreakdown).toHaveBeenCalledWith(expect.anything(), "acct_1", "2026-08-24", "2026-09-06");
    if (r.state === "ready") expect(r.view.totals.visitors).toBe(25);
  });
});
