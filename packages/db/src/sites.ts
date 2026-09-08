import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A client's website: the link between their account and the Vercel project
 * BIS built and hosts (spec 2026-09-07-website-traffic-design). One per
 * account for now. Every write here is the cron's or the agency's through
 * serviceDb(); `authenticated` holds SELECT only (0029).
 */
export type SiteRow = {
  id: string; accountId: string; vercelProjectId: string; domain: string;
  analyticsEnabledAt: string | null; lastSyncedDay: string | null;
};
export type TrafficDay = { day: string; visitors: number; pageviews: number };
export type TrafficDimension = "page" | "source" | "place" | "device";
export type TrafficBreakdownRow = {
  day: string; dimension: TrafficDimension; value: string; visitors: number; pageviews: number;
};

const SITE_COLS = "id, account_id, vercel_project_id, domain, analytics_enabled_at, last_synced_day";

type SiteDbRow = {
  id: string; account_id: string; vercel_project_id: string; domain: string;
  analytics_enabled_at: string | null; last_synced_day: string | null;
};

function toSite(r: SiteDbRow): SiteRow {
  return {
    id: r.id, accountId: r.account_id, vercelProjectId: r.vercel_project_id, domain: r.domain,
    analyticsEnabledAt: r.analytics_enabled_at, lastSyncedDay: r.last_synced_day,
  };
}

export async function getSiteForAccount(db: SupabaseClient, accountId: string): Promise<SiteRow | null> {
  const { data, error } = await db.from("sites").select(SITE_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getSiteForAccount failed: ${error.message}`);
  return data ? toSite(data as SiteDbRow) : null;
}

export async function upsertSite(
  db: SupabaseClient, accountId: string,
  input: { vercelProjectId: string; domain: string; analyticsEnabledAt?: string | null },
): Promise<SiteRow> {
  const row: Record<string, unknown> = {
    account_id: accountId, vercel_project_id: input.vercelProjectId, domain: input.domain,
  };
  if (input.analyticsEnabledAt !== undefined) row.analytics_enabled_at = input.analyticsEnabledAt;
  const { data, error } = await db.from("sites")
    .upsert(row, { onConflict: "account_id" }).select(SITE_COLS).single();
  // The SQLSTATE rides along: `vercel_project_id` is unique across accounts,
  // and the link action tells 23505 apart from everything else.
  if (error || !data) throw Object.assign(new Error(`upsertSite failed: ${error?.message}`), { code: error?.code ?? null });
  return toSite(data as SiteDbRow);
}

/** Every linked site with its account's timezone — the pass decides per
 *  site whether "yesterday" has ended there. */
export async function listSitesToSync(db: SupabaseClient): Promise<(SiteRow & { accountTimezone: string })[]> {
  const { data, error } = await db.from("sites")
    .select(`${SITE_COLS}, accounts!inner(timezone)`).order("created_at", { ascending: true });
  if (error) throw new Error(`listSitesToSync failed: ${error.message}`);
  return ((data ?? []) as unknown as (SiteDbRow & { accounts: { timezone: string } })[]).map((r) => ({
    ...toSite(r), accountTimezone: r.accounts.timezone,
  }));
}

/**
 * One local day for one site: totals upserted, the day's breakdown replaced
 * (delete then insert) so a re-pull never doubles a row. Not a transaction —
 * PostgREST has none — so the order is totals LAST: a failure between the
 * breakdown delete and its insert leaves a day with totals missing, which
 * the pass re-pulls because the site was not stamped.
 */
export async function writeTrafficDay(
  db: SupabaseClient, site: { id: string; accountId: string }, day: string,
  totals: { visitors: number; pageviews: number },
  breakdown: Omit<TrafficBreakdownRow, "day">[],
): Promise<void> {
  const del = await db.from("site_traffic_breakdown").delete().eq("site_id", site.id).eq("day", day);
  if (del.error) throw new Error(`writeTrafficDay breakdown delete failed: ${del.error.message}`);
  if (breakdown.length > 0) {
    const ins = await db.from("site_traffic_breakdown").insert(breakdown.map((b) => ({
      site_id: site.id, account_id: site.accountId, day,
      dimension: b.dimension, value: b.value, visitors: b.visitors, pageviews: b.pageviews,
    })));
    if (ins.error) throw new Error(`writeTrafficDay breakdown insert failed: ${ins.error.message}`);
  }
  const up = await db.from("site_traffic_daily").upsert({
    site_id: site.id, account_id: site.accountId, day, visitors: totals.visitors, pageviews: totals.pageviews,
  }, { onConflict: "site_id,day" });
  if (up.error) throw new Error(`writeTrafficDay totals failed: ${up.error.message}`);
}

export async function stampSiteSynced(db: SupabaseClient, siteId: string, day: string): Promise<void> {
  const { error } = await db.from("sites").update({ last_synced_day: day }).eq("id", siteId);
  if (error) throw new Error(`stampSiteSynced failed: ${error.message}`);
}

/** How many days of traffic are stored for the account's site — what an
 *  unlink would remove, named in its confirmation. */
export async function countTrafficDays(db: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await db.from("site_traffic_daily")
    .select("day", { count: "exact", head: true }).eq("account_id", accountId);
  if (error) throw new Error(`countTrafficDays failed: ${error.message}`);
  return count ?? 0;
}

/** Removes the account's site and everything stored for it, in the order the
 *  RESTRICT foreign keys demand: breakdown rows, daily rows, then the site.
 *  Service role only — `sites` has no client write grant (0029). Idempotent:
 *  with nothing linked it deletes nothing and says so. */
export async function unlinkSite(db: SupabaseClient, accountId: string): Promise<{ daysDeleted: number }> {
  const site = await getSiteForAccount(db, accountId);
  if (!site) return { daysDeleted: 0 };
  const breakdown = await db.from("site_traffic_breakdown").delete().eq("site_id", site.id);
  if (breakdown.error) throw new Error(`unlinkSite breakdown delete failed: ${breakdown.error.message}`);
  const daily = await db.from("site_traffic_daily").delete({ count: "exact" }).eq("site_id", site.id);
  if (daily.error) throw new Error(`unlinkSite daily delete failed: ${daily.error.message}`);
  const row = await db.from("sites").delete().eq("id", site.id);
  if (row.error) throw new Error(`unlinkSite site delete failed: ${row.error.message}`);
  return { daysDeleted: daily.count ?? 0 };
}

export async function listTrafficDays(
  db: SupabaseClient, accountId: string, fromDay: string, toDay: string,
): Promise<TrafficDay[]> {
  const { data, error } = await db.from("site_traffic_daily")
    .select("day, visitors, pageviews").eq("account_id", accountId)
    .gte("day", fromDay).lte("day", toDay).order("day", { ascending: true });
  if (error) throw new Error(`listTrafficDays failed: ${error.message}`);
  return (data ?? []) as TrafficDay[];
}

export async function listTrafficBreakdown(
  db: SupabaseClient, accountId: string, fromDay: string, toDay: string,
): Promise<TrafficBreakdownRow[]> {
  const { data, error } = await db.from("site_traffic_breakdown")
    .select("day, dimension, value, visitors, pageviews").eq("account_id", accountId)
    .gte("day", fromDay).lte("day", toDay).order("day", { ascending: true });
  if (error) throw new Error(`listTrafficBreakdown failed: ${error.message}`);
  return (data ?? []) as TrafficBreakdownRow[];
}
