import type { SupabaseClient } from "@bis/db";
import { getSiteForAccount, listTrafficDays, listTrafficBreakdown } from "@bis/db";
import { safeZone } from "@/lib/booking/time";
import { buildWebsiteView, windowDayKeys, type Period, type WebsiteView } from "./view-model";

export type WebsiteState =
  | { state: "unlinked" }
  | { state: "waiting"; domain: string }
  | { state: "ready"; domain: string; view: WebsiteView };

/**
 * Everything the Website page needs, from BIS's own tables only — never
 * Vercel. Reads the account's timezone itself (the [accountId] layout
 * confirms the account exists but does not pass it down): the windows are
 * local days, and "yesterday" is the account's yesterday.
 */
export async function loadWebsiteState(
  db: SupabaseClient, accountId: string, period: Period, now: Date,
): Promise<WebsiteState> {
  const site = await getSiteForAccount(db, accountId);
  if (!site) return { state: "unlinked" };
  if (!site.lastSyncedDay) return { state: "waiting", domain: site.domain };

  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`website: account timezone read failed: ${error.message}`);
  const timezone = safeZone((data as { timezone?: string } | null)?.timezone, "America/Chicago");

  const { current, prior } = windowDayKeys(now, timezone, period);
  const fromDay = prior[0]!;
  const toDay = current[current.length - 1]!;
  const [daily, breakdown] = await Promise.all([
    listTrafficDays(db, accountId, fromDay, toDay),
    listTrafficBreakdown(db, accountId, fromDay, toDay),
  ]);
  return {
    state: "ready", domain: site.domain,
    view: buildWebsiteView({ now, timezone, period, daily, breakdown, lastSyncedDay: site.lastSyncedDay }),
  };
}
