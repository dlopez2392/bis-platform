import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import {
  getSiteForAccount, upsertSite, listSitesToSync, writeTrafficDay, stampSiteSynced, unlinkSite, countTrafficDays,
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

  /**
   * A suppressed account's site is not a site to sync. Unlike the five
   * sending passes, nothing here would MAIL anyone — the damage is quieter
   * and never stops: `vercel_project_id` on a demo account points at no real
   * Vercel project, so every tick past 03:00 local calls the API, fails,
   * logs, and burns one of the pass's `AUTOMATION_TICK_CAP` attempts that a
   * real site is waiting behind.
   *
   * The site is asserted present BEFORE the flag is set, so what changes the
   * answer is the flag and not a site that was never eligible.
   *
   * Mutation: drop the `.eq("accounts.outbound_suppressed", false)` from
   * listSitesToSync — the site comes back after suppression and this fails.
   */
  it("a suppressed account's site is never handed to the sync pass", () =>
    withTestAccount(async (db, accountId) => {
      const site = await upsertSite(db, accountId,
        { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "demo.example" });
      expect((await listSitesToSync(db)).some((s) => s.id === site.id)).toBe(true);

      const { error } = await db.from("accounts")
        .update({ outbound_suppressed: true }).eq("id", accountId);
      expect(error).toBeNull();
      expect((await listSitesToSync(db)).some((s) => s.id === site.id)).toBe(false);

      // Reversible, like the booking guard: clearing the flag restores it.
      await db.from("accounts").update({ outbound_suppressed: false }).eq("id", accountId);
      expect((await listSitesToSync(db)).some((s) => s.id === site.id)).toBe(true);
    }));

  // Mutation: drop `{ code }` from upsertSite's throw — the action can no
  // longer tell "another client holds that project" from any other failure.
  it("a project already linked to another account is refused, and the error carries SQLSTATE 23505", () =>
    withTestAccount(async (db, first) =>
      withTestAccount(async (_db, second) => {
        const prj = `prj_t_${first.slice(0, 8)}`;
        await upsertSite(db, first, { vercelProjectId: prj, domain: "one.example" });
        await expect(upsertSite(db, second, { vercelProjectId: prj, domain: "two.example" }))
          .rejects.toMatchObject({ code: "23505" });
        expect(await getSiteForAccount(db, second)).toBeNull();
      })));

  // Mutation: delete the site before its traffic rows — the RESTRICT FKs
  // refuse and nothing is removed; skip the breakdown delete — the daily
  // delete goes through but the site delete refuses (breakdown's FK is to
  // sites), and the breakdown rows are still there.
  it("unlinkSite removes breakdown, days and the site in FK order and reports the days removed; countTrafficDays sees them first", () =>
    withTestAccount(async (db, accountId) => {
      const site = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "one.example" });
      await writeTrafficDay(db, site, "2026-09-01", { visitors: 3, pageviews: 4 },
        [{ dimension: "page", value: "/", visitors: 3, pageviews: 4 }]);
      await writeTrafficDay(db, site, "2026-09-02", { visitors: 1, pageviews: 1 }, []);
      expect(await countTrafficDays(db, accountId)).toBe(2);
      expect(await unlinkSite(db, accountId)).toEqual({ daysDeleted: 2 });
      expect(await getSiteForAccount(db, accountId)).toBeNull();
      expect(await listTrafficDays(db, accountId, "2026-01-01", "2026-12-31")).toEqual([]);
      expect(await listTrafficBreakdown(db, accountId, "2026-01-01", "2026-12-31")).toEqual([]);
      expect(await countTrafficDays(db, accountId)).toBe(0);
      // Nothing linked: a no-op that says so.
      expect(await unlinkSite(db, accountId)).toEqual({ daysDeleted: 0 });
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

  /**
   * D-054: PostgREST on this project caps a single response at 1,000 rows
   * (supabase/config.toml, `max_rows = 1000`) — silently, no error, just
   * fewer rows than exist. `listTrafficBreakdown` had no `.range()` at all,
   * and the window a Website page view actually reads (load.ts: the
   * CURRENT period plus the PRIOR one of equal length, for the delta) can
   * be up to 60 days at the longest period x up to 4 dimensions x the
   * API's own 20-per-dimension cap = up to 4,800 rows — past that limit
   * always lost the TAIL of its `order("day", { ascending: true })` read
   * — the rows for its NEWEST days, exactly backwards from what the
   * Website page needs (the chart and the panels read the most RECENT
   * days first).
   *
   * Mutation: drop the `.range()` loop back to a single unbounded read —
   * day 2's 100 rows push the account past 1,000 and the newest day's
   * rows are the ones missing.
   */
  it("listTrafficBreakdown returns every row past PostgREST's 1,000-row cap, including the newest day's (mutation: drop the .range() loop → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const site = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "busy.example" });
      const oldRows = Array.from({ length: 950 }, (_, i) => ({ dimension: "page" as const, value: `/old-${i}`, visitors: 1, pageviews: 1 }));
      const newRows = Array.from({ length: 100 }, (_, i) => ({ dimension: "page" as const, value: `/new-${i}`, visitors: 1, pageviews: 1 }));
      await writeTrafficDay(db, site, "2026-08-01", { visitors: 950, pageviews: 950 }, oldRows);
      await writeTrafficDay(db, site, "2026-08-02", { visitors: 100, pageviews: 100 }, newRows);

      const rows = await listTrafficBreakdown(db, accountId, "2026-08-01", "2026-08-02");
      expect(rows.length).toBe(1050);
      const newestValues = new Set(rows.filter((r) => r.day === "2026-08-02").map((r) => r.value));
      expect(newestValues.size).toBe(100);
    });
  }, 30_000);
});
