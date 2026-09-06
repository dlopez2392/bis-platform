import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { brandDisplayName, type Branding } from "./branding";
import { loadAccountBrandInfo } from "./booking";

/**
 * The automations spine. Config is GENERIC — one row per (account, recipe)
 * holding a toggle, a prose body and a jsonb config — and due-ness is
 * DOMAIN-SPECIFIC: each recipe's due-list reads its own domain rows and its
 * own stamp column, so a booking that is cancelled or un-completed just stops
 * matching. There is no void step and nothing to forget.
 *
 * The catalogue is fixed (a CHECK constraint in 0025 mirrors `RecipeKey`).
 * Milestone B adds keys in its own migration.
 */
export type RecipeKey = "review_request";

export type AutomationRow = {
  id: string; account_id: string; recipe_key: RecipeKey;
  enabled: boolean; body: string;
  /** Raw jsonb. NEVER trusted: parse it with the recipe's own parser on every
   *  read, and validate it on every write. */
  config: unknown;
  created_at: string; updated_at: string;
};

const AUTOMATION_COLS = "id, account_id, recipe_key, enabled, body, config, created_at, updated_at";

export async function getAutomation(
  db: SupabaseClient, accountId: string, recipeKey: RecipeKey,
): Promise<AutomationRow | null> {
  const { data, error } = await db.from("automations")
    .select(AUTOMATION_COLS).eq("account_id", accountId).eq("recipe_key", recipeKey).maybeSingle();
  if (error) throw new Error(`getAutomation failed: ${error.message}`);
  return (data as AutomationRow | null) ?? null;
}

/**
 * serviceDb()-only by grant (0025: `authenticated` holds SELECT and nothing
 * else). Every caller is an agency-gated server action; nothing in the
 * database stands behind that except this grant, so callers MUST check
 * `isAgency` themselves. One row per (account, recipe): the unique constraint
 * is what `onConflict` targets.
 */
export async function upsertAutomation(
  db: SupabaseClient, accountId: string, recipeKey: RecipeKey,
  patch: { enabled: boolean; body: string; config: Record<string, unknown> },
  actorId: string, actorType: ActorType = "user",
): Promise<AutomationRow> {
  const { data, error } = await db.from("automations")
    .upsert({
      account_id: accountId, recipe_key: recipeKey,
      enabled: patch.enabled, body: patch.body, config: patch.config,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id,recipe_key" })
    .select(AUTOMATION_COLS).single();
  if (error || !data) throw new Error(`upsertAutomation failed: ${error?.message}`);
  await emit(db, accountId, "automation.updated", actorId,
    { recipeKey, enabled: patch.enabled }, actorType);
  return data as unknown as AutomationRow;
}

// ---------------------------------------------------------------------------
// Recipe: review request after a completed job
// ---------------------------------------------------------------------------

export type ReviewRequestChannel = "email" | "sms";
export type ReviewRequestConfig = { channel: ReviewRequestChannel; reviewUrl: string };

const MAX_REVIEW_URL_LENGTH = 2048;

/**
 * jsonb is untyped, so the stored config is validated on READ (here, by the
 * due-list) and on WRITE (the settings action), never trusted. `null` means
 * "treat as missing" — the pass counts it and sends nothing. Only http(s):
 * a `javascript:` URL in an email button is the obvious reason; a URL of any
 * other scheme is not something a review page lives at.
 */
export function parseReviewRequestConfig(raw: unknown): ReviewRequestConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel, reviewUrl } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  if (typeof reviewUrl !== "string") return null;
  const url = reviewUrl.trim();
  if (url.length === 0 || url.length > MAX_REVIEW_URL_LENGTH) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // The NORMALISED form, not the raw string: `new URL("https://x/a b")`
  // parses, but the literal space would break the link inside an SMS.
  // `href` percent-encodes it (and adds the trailing slash a bare origin
  // needs), so what is stored, previewed and sent is one clickable string.
  return { channel, reviewUrl: parsed.href };
}

/**
 * The oldest a completed meeting may be and still earn a review request, and
 * the figure the due-query window is sized to. DERIVED, not picked:
 *
 *   37h  the follow-up's own worst case (FOLLOWUP_MAX_AGE_MS in
 *        apps/web/src/lib/booking/followup-timing.ts): a meeting ending at
 *        00:00 local on a 26-hour day (Antarctica/Troll's fall-back) waits
 *        until 11:00 local on D+1, the close of the follow-up's morning band.
 *  +24h  the review request defers to the follow-up: it sends only on a
 *        strictly LATER local day than `followup_sent_at`, so when the
 *        follow-up went out at the very close of D+1's band, the review
 *        request's last qualifying tick is 11:00 on D+2.
 *  = 61h
 *
 * Pinned against real zones in review-request-gate.test.ts. The web gate
 * imports THIS constant rather than restating it — the follow-up's 37h is
 * duplicated across the package boundary and prose-linked; this one is not.
 *
 * Bounded catch-up, stated honestly: if the follow-up itself was late (sent
 * on D+2 by its own catch-up), the review request lands on D+3 and this cap
 * drops it — a missing nicety, never a mistimed one. The safe direction.
 */
export const REVIEW_REQUEST_MAX_AGE_MS = 61 * 60 * 60 * 1000;

/**
 * What the review-request pass is handed per due booking.
 *
 * `brandName` and NEVER `accountName`: `accounts.name` is the agency's
 * internal label ("Rio Roofing — trial") and has reached customers three
 * times. It is resolved here, in the data layer, by `brandDisplayName`, and
 * the row simply has no field for the raw label. A recipe author cannot
 * reach it.
 *
 * `contactPhone` is RAW (`contacts.phone` is only trimmed on write) — the
 * pass runs it through `toE164` and treats a null result as "no deliverable
 * address", exactly as `sendSmsAction` does.
 */
export type DueReviewRequest = {
  bookingId: string; accountId: string;
  /** `ends_at` — "the morning after" is measured from when it ENDED. */
  endsAt: string;
  /** THE COLLISION INPUT. The calendar's follow-up email already fires the
   *  morning after a completed meeting; the gate defers the review request
   *  to a strictly later local day than this stamp. Null when no follow-up
   *  was sent (feature off, no email, send failed) — then nothing to defer to. */
  followupSentAt: string | null;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  /** The operator's prose, "" meaning "use the default at send time". */
  body: string;
  /** Parsed and validated; null when the stored jsonb fails validation. */
  config: ReviewRequestConfig | null;
};

/**
 * Candidates, not decisions: everything returned here still goes through
 * `shouldSendReviewRequestNow` in the pass, which decides the MOMENT. The
 * query only says "enabled, completed, unstamped, inside 61h".
 *
 * `automations` first, then `bookings`: an idle tick on a platform where no
 * account has this recipe on costs ONE narrow indexed read and zero booking
 * reads. There is no FK from bookings to automations, so PostgREST cannot
 * embed the join; two queries is the honest shape.
 */
export async function listDueReviewRequests(
  db: SupabaseClient, nowIso: string,
): Promise<DueReviewRequest[]> {
  const { data: autoData, error: autoErr } = await db.from("automations")
    .select("account_id, body, config")
    .eq("recipe_key", "review_request").eq("enabled", true);
  if (autoErr) throw new Error(`listDueReviewRequests automations read failed: ${autoErr.message}`);
  const enabled = (autoData ?? []) as { account_id: string; body: string; config: unknown }[];
  if (enabled.length === 0) return [];
  const byAccount = new Map(enabled.map((a) => [a.account_id, a] as const));

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - REVIEW_REQUEST_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, followup_sent_at, contacts(email, phone)")
    .in("account_id", [...byAccount.keys()])
    .eq("status", "completed").is("review_requested_at", null)
    .gte("ends_at", windowStart).lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueReviewRequests failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueReviewRequests");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = byAccount.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      endsAt: r.ends_at,
      followupSentAt: r.followup_sent_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null,
      contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding, info.accountName),
      branding: info.branding,
      accountTimezone: info.accountTimezone,
      fromEmail: info.fromEmail,
      replyToEmail: info.replyToEmail,
      body: auto.body ?? "",
      config: parseReviewRequestConfig(auto.config),
    };
  });
}

/** Send-then-stamp, same reasoning as stampReminderSent: only after a confirmed send. */
export async function stampReviewRequested(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ review_requested_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReviewRequested failed: ${error.message}`);
}

/**
 * The daily cap's input: how many review requests this account has sent
 * since `sinceIso`, read off the stamp column itself. Counting stamps (not a
 * separate ledger) is what lets the cap need no new table and no timezone —
 * "a day" is a rolling 24 hours from the tick.
 */
export async function countReviewRequestsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("review_requested_at", sinceIso);
  if (error) throw new Error(`countReviewRequestsSince failed: ${error.message}`);
  return count ?? 0;
}
