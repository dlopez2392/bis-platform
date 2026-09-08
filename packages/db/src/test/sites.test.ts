import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import {
  getSiteForAccount, upsertSite, listSitesToSync, writeTrafficDay, stampSiteSynced,
  listTrafficDays, listTrafficBreakdown,
} from "../sites";

/** Real database, rolled up by withTestAccount's cleanup (the three new
 *  tables were added to its list in Task 2). Mutation for the round trip:
 *  make writeTrafficDay skip the breakdown delete — the second write's
 *  breakdown count doubles. */
describe("sites data layer", () => {
  it("links a site once per account, and upsert updates in place", () =>
    withTestAccount(async (db, accountId) => {
      expect(await getSiteForAccount(db, accountId)).toBeNull();
      const created = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "one.example" });
      expect(created.accountId).toBe(accountId);
      expect(created.lastSyncedDay).toBeNull();
      const updated = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "two.example", analyticsEnabledAt: "2026-09-07T00:00:00.000Z" });
      expect(updated.id).toBe(created.id);
      expect(updated.domain).toBe("two.example");
      expect(updated.analyticsEnabledAt).not.toBeNull();
      const due = await listSitesToSync(db);
      const mine = due.find((s) => s.id === created.id);
      expect(mine?.accountTimezone).toBe("America/Chicago");
    }));

  it("writes a day (totals + breakdown), replaces it on rewrite, stamps, and reads back in order", () =>
    withTestAccount(async (db, accountId) => {
      const site = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "one.example" });
      await writeTrafficDay(db, site, "2026-09-02", { visitors: 5, pageviews: 9 }, [
        { dimension: "page", value: "/", visitors: 5, pageviews: 7 },
        { dimension: "source", value: "google.com", visitors: 3, pageviews: 5 },
      ]);
      await writeTrafficDay(db, site, "2026-09-01", { visitors: 2, pageviews: 3 }, [
        { dimension: "page", value: "/", visitors: 2, pageviews: 3 },
      ]);
      // A rewrite of the same day REPLACES its breakdown rather than adding to it.
      await writeTrafficDay(db, site, "2026-09-02", { visitors: 6, pageviews: 10 }, [
        { dimension: "page", value: "/services", visitors: 6, pageviews: 8 },
      ]);
      await stampSiteSynced(db, site.id, "2026-09-02");

      const days = await listTrafficDays(db, accountId, "2026-09-01", "2026-09-02");
      expect(days).toEqual([
        { day: "2026-09-01", visitors: 2, pageviews: 3 },
        { day: "2026-09-02", visitors: 6, pageviews: 10 },
      ]);
      const rows = await listTrafficBreakdown(db, accountId, "2026-09-02", "2026-09-02");
      expect(rows).toEqual([{ day: "2026-09-02", dimension: "page", value: "/services", visitors: 6, pageviews: 8 }]);
      expect((await getSiteForAccount(db, accountId))?.lastSyncedDay).toBe("2026-09-02");
    }));
});
