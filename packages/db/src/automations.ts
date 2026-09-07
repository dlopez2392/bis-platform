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
 * The catalogue is fixed (the CHECK in 0025 + 0026 mirrors `RecipeKey`).
 */
export type RecipeKey = "review_request" | "no_show_nudge" | "sms_reminder";

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
// Shared by every due-list
// ---------------------------------------------------------------------------

type EnabledRecipe = { body: string; config: unknown };

/**
 * Every account with `recipeKey` switched on, keyed by account id — the first
 * of the two reads each due-list makes. `automations` first, then the domain
 * table: an idle tick on a platform where no account has the recipe on costs
 * ONE narrow indexed read and zero booking reads. There is no FK from
 * bookings to automations, so PostgREST cannot embed the join; two queries
 * is the honest shape.
 */
async function listEnabled(
  db: SupabaseClient, recipeKey: RecipeKey, caller: string,
): Promise<Map<string, EnabledRecipe>> {
  const { data, error } = await db.from("automations")
    .select("account_id, body, config")
    .eq("recipe_key", recipeKey).eq("enabled", true);
  if (error) throw new Error(`${caller} automations read failed: ${error.message}`);
  const rows = (data ?? []) as { account_id: string; body: string; config: unknown }[];
  return new Map(rows.map((a) => [a.account_id, { body: a.body ?? "", config: a.config }] as const));
}

/**
 * "EITHER anchor is inside the window": ends_at OR the status clock (0026)
 * is at or after `sinceIso`. A pre-0026 row has a null clock and matches by
 * ends_at alone; a job marked days after it ended matches by the clock.
 *
 * PostgREST's `or` filter takes its values inline, and an ISO instant carries
 * two of its reserved characters (`.` and `:`), so each value is double-quoted
 * — the documented escape. `toISOString()` never emits `"`, `,` or `(`, the
 * characters that would break the quoting; contacts.ts's search path is the
 * precedent for treating an interpolated `.or()` with suspicion. Proven
 * against the real database in automations.test.ts.
 */
function eitherAnchorSince(clockColumn: string, sinceIso: string): string {
  return `ends_at.gte."${sinceIso}",${clockColumn}.gte."${sinceIso}"`;
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
  // needs). The settings action stores THIS value too, so what is stored,
  // previewed and sent is one clickable string.
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
 * Since 0026 the clock runs from the LATER of ends_at and completed_at
 * (laterOf, apps/web/src/lib/automations/anchor.ts); the derivation is
 * unchanged, only the instant it starts from moved.
 *
 * Pinned against real zones in review-request-gate.test.ts. The web gate
 * imports THIS constant rather than restating it.
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
  /** `ends_at`. The pass runs the clock from laterOf(endsAt, completedAt). */
  endsAt: string;
  /** THE COMPLETION CLOCK (0026): when the operator pressed "Mark completed".
   *  Null on rows completed before the migration — then the clock is ends_at
   *  alone, exactly as before. */
  completedAt: string | null;
  /** THE COLLISION INPUT. The calendar's follow-up email already fires the
   *  morning after a completed meeting; the gate defers the review request
   *  to a strictly later local day than this stamp. Null when no follow-up
   *  was sent (feature off, no email, send failed) — then nothing to defer to. */
  followupSentAt: string | null;
  /** The last FAILED SMS attempt for this booking's review request (0026).
   *  The pass holds the row for 24h after it and counts the hold. Null =
   *  never failed. An attempt marker, never a receipt. */
  smsFailedAt: string | null;
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
 * query only says "enabled, completed, unstamped, inside 61h by either
 * anchor".
 */
export async function listDueReviewRequests(
  db: SupabaseClient, nowIso: string,
): Promise<DueReviewRequest[]> {
  const enabled = await listEnabled(db, "review_request", "listDueReviewRequests");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - REVIEW_REQUEST_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, completed_at, followup_sent_at, review_request_sms_failed_at, contacts(email, phone)")
    .in("account_id", [...enabled.keys()])
    .eq("status", "completed").is("review_requested_at", null)
    .or(eitherAnchorSince("completed_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueReviewRequests failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueReviewRequests");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = enabled.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      endsAt: r.ends_at,
      completedAt: r.completed_at ?? null,
      followupSentAt: r.followup_sent_at ?? null,
      smsFailedAt: r.review_request_sms_failed_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null,
      contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding, info.accountName),
      branding: info.branding,
      accountTimezone: info.accountTimezone,
      fromEmail: info.fromEmail,
      replyToEmail: info.replyToEmail,
      body: auto.body,
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

/** The ATTEMPT marker, never the dedupe stamp: written by the pass when the
 *  provider refuses a text, read back by the same pass to hold the booking
 *  for 24h (SMS_RETRY_COOLDOWN_MS). */
export async function stampReviewRequestSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ review_request_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReviewRequestSmsFailed failed: ${error.message}`);
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

// ---------------------------------------------------------------------------
// Recipe: no-show → rebooking nudge
// ---------------------------------------------------------------------------

export type NoShowNudgeChannel = "email" | "sms";
export type NoShowNudgeConfig = { channel: NoShowNudgeChannel };

/** Same contract as parseReviewRequestConfig: validated on read AND write,
 *  null means "treat as missing". The nudge's link is the account's own
 *  booking page (due-row `calendarPublicId`), so there is no URL to validate. */
export function parseNoShowNudgeConfig(raw: unknown): NoShowNudgeConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  return { channel };
}

/**
 * 37 hours — the follow-up's own derivation, because the nudge has nothing
 * to defer to: a booking whose clock (laterOf(ends_at, no_show_at)) reads
 * 00:00 local on a 26-hour day waits until 11:00 on D+1, the close of the
 * morning band: 26 + 11 = 37. Pinned on Antarctica/Troll in
 * no-show-nudge-gate.test.ts and equal to FOLLOWUP_QUERY_WINDOW_MS in
 * cron-coupling.test.ts. The web gate imports THIS constant.
 */
export const NO_SHOW_NUDGE_MAX_AGE_MS = 37 * 60 * 60 * 1000;

export type DueNoShowNudge = {
  bookingId: string; accountId: string;
  endsAt: string;
  /** THE NO-SHOW CLOCK (0026): when the operator pressed "Mark no-show".
   *  Null on rows flipped before the migration. */
  noShowAt: string | null;
  /** The last FAILED SMS attempt for this booking's nudge (0026). */
  smsFailedAt: string | null;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  /** The rebook link's target: `${origin}/b/${calendarPublicId}`. */
  calendarPublicId: string;
  /** The public page 404s while this is false (b/[publicId]/page.tsx); the
   *  pass skips and counts rather than send a dead link. */
  calendarEnabled: boolean;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  body: string;
  config: NoShowNudgeConfig | null;
};

/** Candidates, not decisions — `shouldSendNoShowNudgeNow` in the pass picks
 *  the moment. "Enabled, no_show, unstamped, inside 37h by either anchor". */
export async function listDueNoShowNudges(
  db: SupabaseClient, nowIso: string,
): Promise<DueNoShowNudge[]> {
  const enabled = await listEnabled(db, "no_show_nudge", "listDueNoShowNudges");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - NO_SHOW_NUDGE_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, no_show_at, no_show_nudge_sms_failed_at, calendars(public_id, enabled), contacts(email, phone)")
    .in("account_id", [...enabled.keys()])
    .eq("status", "no_show").is("no_show_nudged_at", null)
    .or(eitherAnchorSince("no_show_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueNoShowNudges failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueNoShowNudges");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = enabled.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      endsAt: r.ends_at,
      noShowAt: r.no_show_at ?? null,
      smsFailedAt: r.no_show_nudge_sms_failed_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null,
      contactPhone: r.contacts?.phone ?? null,
      calendarPublicId: r.calendars?.public_id,
      calendarEnabled: r.calendars?.enabled === true,
      brandName: brandDisplayName(info.branding, info.accountName),
      branding: info.branding,
      accountTimezone: info.accountTimezone,
      fromEmail: info.fromEmail,
      replyToEmail: info.replyToEmail,
      body: auto.body,
      config: parseNoShowNudgeConfig(auto.config),
    };
  });
}

export async function stampNoShowNudged(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ no_show_nudged_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampNoShowNudged failed: ${error.message}`);
}

export async function stampNoShowNudgeSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ no_show_nudge_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampNoShowNudgeSmsFailed failed: ${error.message}`);
}

/** The daily cap's input for the nudge — the dedupe stamp, never the attempt marker. */
export async function countNoShowNudgesSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("no_show_nudged_at", sinceIso);
  if (error) throw new Error(`countNoShowNudgesSince failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Recipe: ~2h SMS booking reminder
// ---------------------------------------------------------------------------

/**
 * ~2 hours before `starts_at`, by text. The window's CLOSE (2h15m) decides
 * when a booking first qualifies — the first tick at which starts_at is at
 * most 2h15m away, so the text lands 2h–2h15m ahead; the OPEN (1h30m) is how
 * long a missed tick can catch up before a "reminder" would be silly. 45
 * minutes = three ticks, wider than one (cron-coupling.test.ts pins it
 * against vercel.json). A booking made less than 90 minutes ahead gets no
 * text: it was never inside. Sibling of REMINDER_WINDOW_* in booking.ts.
 */
export const SMS_REMINDER_WINDOW_START_MS = 90 * 60 * 1000;
export const SMS_REMINDER_WINDOW_END_MS = 135 * 60 * 1000;

/** SMS only, so the row carries no email address at all — the type is how a
 *  recipe author is kept from sending this by mail. */
export type DueSmsReminder = {
  bookingId: string; accountId: string;
  startsAt: string;
  /** The booker's own zone, captured at booking, for the time in the text —
   *  `safeZone(bookerTimezone, accountTimezone)` as the email reminder does. */
  bookerTimezone: string | null;
  /** The last FAILED attempt for this booking's text reminder (0026). */
  smsFailedAt: string | null;
  contactId: string; contactPhone: string | null;
  brandName: string; accountTimezone: string;
  body: string;
};

/** No gate follows this list: a text reminder is tied to the appointment,
 *  not to a morning, so the window IS the moment. */
export async function listDueSmsReminders(
  db: SupabaseClient, nowIso: string,
): Promise<DueSmsReminder[]> {
  const enabled = await listEnabled(db, "sms_reminder", "listDueSmsReminders");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + SMS_REMINDER_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + SMS_REMINDER_WINDOW_END_MS).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, starts_at, booker_timezone, sms_reminder_failed_at, contacts(phone)")
    .in("account_id", [...enabled.keys()])
    .eq("status", "booked").is("sms_reminder_sent_at", null)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueSmsReminders failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueSmsReminders");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = enabled.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      startsAt: r.starts_at,
      bookerTimezone: r.booker_timezone ?? null,
      smsFailedAt: r.sms_reminder_failed_at ?? null,
      contactId: r.contact_id,
      contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding, info.accountName),
      accountTimezone: info.accountTimezone,
      body: auto.body,
    };
  });
}

export async function stampSmsReminderSent(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ sms_reminder_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampSmsReminderSent failed: ${error.message}`);
}

export async function stampSmsReminderFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ sms_reminder_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampSmsReminderFailed failed: ${error.message}`);
}
