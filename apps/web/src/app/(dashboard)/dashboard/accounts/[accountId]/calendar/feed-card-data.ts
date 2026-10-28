import { serviceDb, readPersonId, readLiveCalendarFeed, type AccountRole } from "@bis/db";
import { feedSecretConfigured, feedToken, feedTokenHash, feedUrl, webcalUrl } from "@/lib/booking/feed-token";
import { loggableError } from "@/lib/loggable-error";

/**
 * F-048 part 2: the Calendar page's "Bookings on your phone" card, read for the SIGNED-IN person only:
 * every read is keyed by readPersonId(route account, the caller's own Clerk id), so a person sees their own
 * link and nobody else's (in-account-service-reads: proven-target). Never throws: a failed read is the
 * card's own error state (DESIGN.md rule 5). Never logs a token.
 */
export type FeedCardView =
  | { kind: "agency" } | { kind: "unavailable" } | { kind: "none" } | { kind: "stale" } | { kind: "error" }
  | { kind: "live"; url: string; webcal: string; lastFetchedAt: string | null; technician: boolean };

export async function loadFeedCardView(a: {
  accountId: string; clerkUserId: string; isAgency: boolean; role: AccountRole | null; origin: string;
}): Promise<FeedCardView> {
  if (a.isAgency) return { kind: "agency" };
  if (!feedSecretConfigured()) return { kind: "unavailable" };
  try {
    const db = serviceDb();
    const userId = await readPersonId(db, a.accountId, a.clerkUserId);
    if (!userId) return { kind: "error" };
    const feed = await readLiveCalendarFeed(db, a.accountId, userId);
    if (!feed) return { kind: "none" };
    const token = feedToken(feed.id);
    // A row made under an earlier secret: the route still serves it (it looks up by hash), but this card can no
    // longer show the link, so it asks for a new one.
    if (feedTokenHash(token) !== feed.token_hash) return { kind: "stale" };
    const url = feedUrl(a.origin, token);
    return { kind: "live", url, webcal: webcalUrl(url), lastFetchedAt: feed.last_fetched_at, technician: a.role === "technician" };
  } catch (e) {
    console.error(`calendar feed card: read failed: ${loggableError(e)}`);
    return { kind: "error" };
  }
}
