import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRole } from "./team";

/**
 * F-048 part 2 (0104): a person's calendar link. Server code only: 0104 grants the table and its four
 * functions to service_role alone, so every caller passes `serviceDb()`, and every read here is scoped to
 * the account AND the person it is given. Never returns or logs a token. THROWS on a read or write error.
 */
export const CALENDAR_FEED_FETCH_MAX = 120;
export const CALENDAR_FEED_FETCH_WINDOW_SECONDS = 3600;
export const CALENDAR_FEED_UNDO_SECONDS = 30;

export type CalendarFeedRow = {
  id: string; account_id: string; user_id: string; token_hash: string;
  created_at: string; revoked_at: string | null; last_fetched_at: string | null;
};
const COLS = "id, account_id, user_id, token_hash, created_at, revoked_at, last_fetched_at";

/** The person's live link in this account, or null. */
export async function readLiveCalendarFeed(db: SupabaseClient, accountId: string, userId: string): Promise<CalendarFeedRow | null> {
  const { data, error } = await db.from("calendar_feeds").select(COLS)
    .eq("account_id", accountId).eq("user_id", userId).is("revoked_at", null).maybeSingle();
  if (error) throw new Error(`readLiveCalendarFeed failed: ${error.message}`);
  return (data as CalendarFeedRow | null) ?? null;
}

/** Make the person's link. `"exists"` when they already have a live one (0104's calendar_feeds_one_live, 23505). */
export async function createCalendarFeed(db: SupabaseClient, a: {
  accountId: string; userId: string; id: string; tokenHash: string; createdBy: string;
}): Promise<"ok" | "exists"> {
  const { error } = await db.from("calendar_feeds").insert({
    id: a.id, account_id: a.accountId, user_id: a.userId, token_hash: a.tokenHash, created_by: a.createdBy,
  });
  if (!error) return "ok";
  if (error.code === "23505") return "exists";
  throw new Error(`createCalendarFeed failed: ${error.message}`);
}

/** Turn off: the database stamps revoked_at with its own now(), the clock restore compares (review M4). */
export async function revokeCalendarFeed(db: SupabaseClient, accountId: string, userId: string): Promise<{ feedId: string; revokedAt: string } | null> {
  const { data, error } = await db.rpc("revoke_calendar_feed", { p_account_id: accountId, p_user_id: userId });
  if (error) throw new Error(`revokeCalendarFeed failed: ${error.message}`);
  const r = data as { status?: string; feed_id?: string; revoked_at?: string } | null;
  if (r?.status === "none") return null;
  if (r?.status === "ok" && r.feed_id && r.revoked_at) return { feedId: r.feed_id, revokedAt: r.revoked_at };
  throw new Error(`revokeCalendarFeed: unexpected answer ${JSON.stringify(r)}`);
}

/** Revoke the live link and insert its successor in one transaction. `"none"`: there was no live link. */
export async function replaceCalendarFeed(db: SupabaseClient, a: {
  accountId: string; userId: string; newId: string; newHash: string; createdBy: string;
}): Promise<{ status: "ok"; previousId: string; revokedAt: string } | { status: "none" }> {
  const { data, error } = await db.rpc("replace_calendar_feed", {
    p_account_id: a.accountId, p_user_id: a.userId, p_new_id: a.newId, p_new_hash: a.newHash, p_created_by: a.createdBy,
  });
  if (error) throw new Error(`replaceCalendarFeed failed: ${error.message}`);
  const r = data as { status?: string; previous_id?: string; revoked_at?: string } | null;
  if (r?.status === "none") return { status: "none" };
  if (r?.status === "ok" && r.previous_id && r.revoked_at) return { status: "ok", previousId: r.previous_id, revokedAt: r.revoked_at };
  throw new Error(`replaceCalendarFeed: unexpected answer ${JSON.stringify(r)}`);
}

/**
 * Undo a turn-off (`replacementId` null) or a replace (the successor's id, which is deleted). Only within
 * CALENDAR_FEED_UNDO_SECONDS of the database's own revoke stamp, and only while nothing has changed since;
 * otherwise `"changed"` and nothing written.
 */
export async function restoreCalendarFeed(db: SupabaseClient, a: {
  accountId: string; userId: string; feedId: string; revokedAt: string; replacementId: string | null;
}): Promise<"restored" | "changed"> {
  const { data, error } = await db.rpc("restore_calendar_feed", {
    p_account_id: a.accountId, p_user_id: a.userId, p_feed_id: a.feedId, p_revoked_at: a.revokedAt,
    p_replacement_id: a.replacementId, p_max_age_seconds: CALENDAR_FEED_UNDO_SECONDS,
  });
  if (error) throw new Error(`restoreCalendarFeed failed: ${error.message}`);
  if (data === "restored" || data === "changed") return data;
  throw new Error(`restoreCalendarFeed: unexpected answer ${JSON.stringify(data)}`);
}

export type FeedClaim =
  | { status: "ok"; feedId: string; accountId: string; userId: string; role: AccountRole; userLanguage: "en" | "es" | null }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterSeconds: number };

const ROLES: readonly string[] = ["owner", "staff", "technician"];

/**
 * One fetch of a link, re-proved under the row lock (0104's claim). An answer this code does not know,
 * including a role outside the three, THROWS: it never falls through to a feed with no fence. The error
 * omits the payload, which would carry ids (never the token) that nothing needs.
 */
export async function claimCalendarFeedFetch(db: SupabaseClient, tokenHash: string): Promise<FeedClaim> {
  const { data, error } = await db.rpc("claim_calendar_feed_fetch", {
    p_token_hash: tokenHash, p_max: CALENDAR_FEED_FETCH_MAX, p_window_seconds: CALENDAR_FEED_FETCH_WINDOW_SECONDS,
  });
  if (error) throw new Error(`claimCalendarFeedFetch failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (r?.status === "not_found") return { status: "not_found" };
  if (r?.status === "rate_limited" && typeof r.retry_after_seconds === "number") {
    return { status: "rate_limited", retryAfterSeconds: r.retry_after_seconds };
  }
  if (r?.status === "ok" && typeof r.feed_id === "string" && typeof r.account_id === "string"
      && typeof r.user_id === "string" && typeof r.role === "string" && ROLES.includes(r.role)) {
    const lang = r.user_language === "en" || r.user_language === "es" ? r.user_language : null;
    return { status: "ok", feedId: r.feed_id, accountId: r.account_id, userId: r.user_id, role: r.role as AccountRole, userLanguage: lang };
  }
  throw new Error("claimCalendarFeedFetch: unexpected answer");
}
