import {
  claimCalendarFeedFetch, listFeedBookings, getBranding, brandDisplayName, FEED_FUTURE_CAP, FEED_PAST_CAP,
  type SupabaseClient,
} from "@bis/db";
import { resolveLocale, type Locale } from "@/lib/i18n/locale";
import { feedTokenHash } from "./feed-token";
import { feedIcsFor } from "./feed-content";

/**
 * F-048 part 2: one fetch of a person's calendar feed. The token is proven FIRST, by its hash, in one locked
 * claim (0104) that also re-proves the membership, client access and the account, and returns the role;
 * every later read carries the CLAIM's account, never anything else. A Technician's window is fenced to
 * their assigned customers. Takes the caller's client (the route's serviceDb), so this file names none.
 * THROWS on a read error, naming the claim's feed id (never the token) once the claim has answered.
 */
export type FeedAnswer =
  | { kind: "ok"; body: string; feedId: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export async function loadCalendarFeed(db: SupabaseClient, token: string, now: Date, origin: string | null): Promise<FeedAnswer> {
  const claim = await claimCalendarFeedFetch(db, feedTokenHash(token));
  if (claim.status === "not_found") return { kind: "not_found" };
  if (claim.status === "rate_limited") return { kind: "rate_limited", retryAfterSeconds: claim.retryAfterSeconds };

  try {
    const { data, error } = await db.from("accounts").select("language").eq("id", claim.accountId).maybeSingle();
    if (error) throw new Error(`account read failed: ${error.message}`);
    const raw = (data as { language: string | null } | null)?.language ?? null;
    const locale: Locale = resolveLocale(claim.userLanguage, raw === "en" || raw === "es" ? raw : null);

    const [feed, branding] = await Promise.all([
      listFeedBookings(db, claim.accountId, { now, technicianUserId: claim.role === "technician" ? claim.userId : null }),
      getBranding(db, claim.accountId),
    ]);
    if (feed.capped.upcoming) console.error(`calendar feed ${claim.feedId}: more than ${FEED_FUTURE_CAP} upcoming bookings; the furthest were left out`);
    if (feed.capped.past) console.error(`calendar feed ${claim.feedId}: more than ${FEED_PAST_CAP} past bookings; the oldest were left out`);
    return {
      kind: "ok", feedId: claim.feedId,
      body: feedIcsFor({ brandName: brandDisplayName(branding), locale, meetingType: feed.meetingType, origin,
        accountId: claim.accountId, rows: feed.rows }),
    };
  } catch (e) {
    throw new Error(`calendar feed ${claim.feedId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
