import { listSitesToSync, writeTrafficDay, stampSiteSynced, type TrafficBreakdownRow } from "@bis/db";
import { vercelAnalyticsFromEnv, type VercelAnalytics, type DayTraffic } from "@/lib/vercel/web-analytics";
import { isPastSyncHour, daysToSync, localDayBounds } from "@/lib/website/sync-window";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { AUTOMATION_TICK_CAP } from "../caps";
import type { Pass } from "../context";

/**
 * Website traffic: one pull per site per local day, into BIS's own tables
 * (spec 2026-09-07-website-traffic-design). Not a recipe — it sends nothing
 * — but it lives in the harness for the same reasons the recipes do: one
 * "now" per tick, per-site isolation, uniform counters in the cron log.
 *
 * Per site, in order, each refusal under its own name:
 *   unresolvable zone → before 03:00 local (yesterday not complete yet) →
 *   nothing due → tick cap → pull each due day OLDEST FIRST, write, stamp;
 *   stop at the first failed day so a hole is never left behind a success.
 *
 * The Vercel client is constructed LAZILY on the first site that needs a
 * pull — `vercelAnalyticsFromEnv()` throws while the token is unset, and
 * that throw is one site's failure, never the pass's. A 429/5xx from Vercel
 * is the same: counted, logged, retried next tick, never looped here.
 */
export const siteTrafficPass: Pass = {
  key: "siteTraffic",
  async run(ctx) {
    const c = { synced: 0, daysSynced: 0, failed: 0, skippedNotYet: 0, skippedUpToDate: 0, skippedCap: 0, unresolvableTimezone: 0 };
    const sites = await listSitesToSync(ctx.db);
    let api: VercelAnalytics | null = null;
    let attempts = 0;

    for (const site of sites) {
      const zone = resolveAccountZone(site.accountTimezone);
      if (zone === null) {
        c.unresolvableTimezone++;
        console.error(`site traffic HELD for site ${site.id}: account ${site.accountId}'s timezone ${JSON.stringify(site.accountTimezone)} is not a zone we can resolve`);
        continue;
      }
      if (!isPastSyncHour(ctx.now, zone)) { c.skippedNotYet++; continue; }
      const days = daysToSync({ now: ctx.now, timezone: zone, lastSyncedDay: site.lastSyncedDay });
      if (days.length === 0) { c.skippedUpToDate++; continue; }
      if (attempts >= AUTOMATION_TICK_CAP) { c.skippedCap++; continue; }
      attempts++;

      let pulled = 0;
      try {
        api ??= vercelAnalyticsFromEnv();
        for (const day of days) {
          const { sinceIso, untilIso } = localDayBounds(day, zone);
          const traffic = await api.fetchDayTraffic(site.vercelProjectId, sinceIso, untilIso);
          await writeTrafficDay(ctx.db, site, day, { visitors: traffic.visitors, pageviews: traffic.pageviews }, toBreakdown(traffic));
          await stampSiteSynced(ctx.db, site.id, day);
          pulled++;
        }
        c.synced++;
      } catch (e) {
        c.failed++;
        console.error(`site traffic pull failed for site ${site.id} (${site.vercelProjectId}) after ${pulled} of ${days.length} days: ${String(e)}`);
      }
      c.daysSynced += pulled;
    }
    return c;
  },
};

function toBreakdown(t: DayTraffic): Omit<TrafficBreakdownRow, "day">[] {
  const rows = (dimension: TrafficBreakdownRow["dimension"], list: DayTraffic["pages"]) =>
    list.map((r) => ({ dimension, value: r.value, visitors: r.visitors, pageviews: r.pageviews }));
  return [...rows("page", t.pages), ...rows("source", t.sources), ...rows("place", t.places), ...rows("device", t.devices)];
}
