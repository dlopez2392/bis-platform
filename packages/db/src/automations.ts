import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { brandDisplayName, type Branding } from "./branding";
import { loadSendableRows, type AccountBrandInfo, type DueLookup } from "./booking";

/**
 * The automations spine. Config is GENERIC — one row per (account, recipe)
 * holding a toggle, a prose body and a jsonb config — and due-ness is
 * DOMAIN-SPECIFIC: each recipe's due-list reads its own domain rows and its
 * own stamp column, so a booking that is cancelled or un-completed just stops
 * matching. There is no void step and nothing to forget.
 *
 * The catalogue is fixed (the CHECK in 0025 + 0026 + 0027 mirrors `RecipeKey`).
 */
export type RecipeKey =
  | "review_request" | "no_show_nudge" | "sms_reminder" | "instant_reply"
  | "appointment_confirm" | "referral_ask" | "reactivation" | "quote_followup";

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
const REVIEW_REQUEST_SELECT =
  "id, account_id, contact_id, ends_at, completed_at, followup_sent_at, review_request_sms_failed_at, contacts(email, phone)";

function toDueReviewRequest(r: any, info: AccountBrandInfo, auto: EnabledRecipe): DueReviewRequest {
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
    brandName: brandDisplayName(info.branding),
    branding: info.branding,
    accountTimezone: info.accountTimezone,
    fromEmail: info.fromEmail,
    replyToEmail: info.replyToEmail,
    body: auto.body,
    config: parseReviewRequestConfig(auto.config),
  };
}

export async function listDueReviewRequests(
  db: SupabaseClient, nowIso: string,
): Promise<DueReviewRequest[]> {
  const enabled = await listEnabled(db, "review_request", "listDueReviewRequests");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - REVIEW_REQUEST_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select(REVIEW_REQUEST_SELECT)
    .in("account_id", [...enabled.keys()])
    .eq("status", "completed").is("review_requested_at", null)
    .or(eitherAnchorSince("completed_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueReviewRequests failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueReviewRequests");

  return sendable.map((r: any) =>
    toDueReviewRequest(r, accountInfo.get(r.account_id as string)!, enabled.get(r.account_id as string)!));
}

async function enabledRecipeFor(db: SupabaseClient, accountId: string, recipeKey: RecipeKey): Promise<EnabledRecipe | null> {
  const row = await getAutomation(db, accountId, recipeKey);
  return row && row.enabled ? { body: row.body ?? "", config: row.config } : null;
}

export async function getDueReviewRequestById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueReviewRequest>> {
  const { data, error } = await db.from("bookings")
    .select(REVIEW_REQUEST_SELECT)
    .eq("id", bookingId).eq("status", "completed").is("review_requested_at", null).maybeSingle();
  if (error) throw new Error(`getDueReviewRequestById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "review_request");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueReviewRequestById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueReviewRequest(data, accountInfo.get((data as any).account_id)!, auto) };
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
const NO_SHOW_NUDGE_SELECT =
  "id, account_id, contact_id, ends_at, no_show_at, no_show_nudge_sms_failed_at, calendars(public_id, enabled), contacts(email, phone)";

function toDueNoShowNudge(r: any, info: AccountBrandInfo, auto: EnabledRecipe): DueNoShowNudge {
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
    brandName: brandDisplayName(info.branding),
    branding: info.branding,
    accountTimezone: info.accountTimezone,
    fromEmail: info.fromEmail,
    replyToEmail: info.replyToEmail,
    body: auto.body,
    config: parseNoShowNudgeConfig(auto.config),
  };
}

export async function listDueNoShowNudges(
  db: SupabaseClient, nowIso: string,
): Promise<DueNoShowNudge[]> {
  const enabled = await listEnabled(db, "no_show_nudge", "listDueNoShowNudges");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - NO_SHOW_NUDGE_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select(NO_SHOW_NUDGE_SELECT)
    .in("account_id", [...enabled.keys()])
    .eq("status", "no_show").is("no_show_nudged_at", null)
    .or(eitherAnchorSince("no_show_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueNoShowNudges failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueNoShowNudges");

  return sendable.map((r: any) =>
    toDueNoShowNudge(r, accountInfo.get(r.account_id as string)!, enabled.get(r.account_id as string)!));
}

export async function getDueNoShowNudgeById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueNoShowNudge>> {
  const { data, error } = await db.from("bookings")
    .select(NO_SHOW_NUDGE_SELECT)
    .eq("id", bookingId).eq("status", "no_show").is("no_show_nudged_at", null).maybeSingle();
  if (error) throw new Error(`getDueNoShowNudgeById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "no_show_nudge");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueNoShowNudgeById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueNoShowNudge(data, accountInfo.get((data as any).account_id)!, auto) };
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
const SMS_REMINDER_SELECT =
  "id, account_id, contact_id, starts_at, booker_timezone, sms_reminder_failed_at, contacts(phone)";

function toDueSmsReminder(r: any, info: AccountBrandInfo, auto: EnabledRecipe): DueSmsReminder {
  return {
    bookingId: r.id,
    accountId: r.account_id,
    startsAt: r.starts_at,
    bookerTimezone: r.booker_timezone ?? null,
    smsFailedAt: r.sms_reminder_failed_at ?? null,
    contactId: r.contact_id,
    contactPhone: r.contacts?.phone ?? null,
    brandName: brandDisplayName(info.branding),
    accountTimezone: info.accountTimezone,
    body: auto.body,
  };
}

export async function listDueSmsReminders(
  db: SupabaseClient, nowIso: string,
): Promise<DueSmsReminder[]> {
  const enabled = await listEnabled(db, "sms_reminder", "listDueSmsReminders");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + SMS_REMINDER_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + SMS_REMINDER_WINDOW_END_MS).toISOString();

  const { data, error } = await db.from("bookings")
    .select(SMS_REMINDER_SELECT)
    .in("account_id", [...enabled.keys()])
    .eq("status", "booked").is("sms_reminder_sent_at", null)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueSmsReminders failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueSmsReminders");

  return sendable.map((r: any) =>
    toDueSmsReminder(r, accountInfo.get(r.account_id as string)!, enabled.get(r.account_id as string)!));
}

export async function getDueSmsReminderById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueSmsReminder>> {
  const { data, error } = await db.from("bookings")
    .select(SMS_REMINDER_SELECT)
    .eq("id", bookingId).eq("status", "booked").is("sms_reminder_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueSmsReminderById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "sms_reminder");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueSmsReminderById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueSmsReminder(data, accountInfo.get((data as any).account_id)!, auto) };
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

// ---------------------------------------------------------------------------
// Recipe: appointment confirmation, two days out (part B)
// ---------------------------------------------------------------------------

/**
 * Two days out, 75 minutes wide — the email reminder's width and for its
 * reason (booking.ts:383-384, the measured cron jitter). The CLOSE is 48h15m
 * so a text sent at the far edge still reads as "two days from now"; the OPEN
 * at 47h is how long a missed tick can catch up. A booking made less than 47
 * hours ahead is never inside and is never asked — its email reminder and its
 * text reminder are already on the way.
 *
 * cron-coupling.test.ts pins both against vercel.json. Change one, change both.
 */
export const APPOINTMENT_CONFIRM_WINDOW_START_MS = 47 * 60 * 60 * 1000;
export const APPOINTMENT_CONFIRM_WINDOW_END_MS = 48 * 60 * 60 * 1000 + 15 * 60 * 1000;

/**
 * The instant the ask stops being worth making: 24 HOURS AND 15 MINUTES
 * before the appointment, which is the instant the EMAIL reminder becomes
 * eligible.
 *
 * Read `REMINDER_WINDOW_*` in booking.ts (:383-384) before changing this. The
 * email reminder's due window is `starts_at ∈ [now + 23h, now + 24h15m]`
 * (:546-547): a booking first matches it on the tick where its lead is
 * 24h15m, and stops matching at 23h. So the window's CLOSE is where the
 * reminder OPENS, and a 24h bound here would leave a fifteen-minute band in
 * which both are due. The collision is ONE TEXT AND ONE EMAIL — "can you
 * confirm?" and "here's your reminder" in the same quarter hour. (Not two
 * texts: the SMS reminder's window is 90-135 minutes, SMS_REMINDER_WINDOW_*
 * above, and cannot meet a 24h lead at all.)
 *
 * Its own literal, not `= REMINDER_WINDOW_END_MS`, and that is deliberate:
 * derived from the import the two could never drift and cron-coupling's
 * assertion could never fail, which is the shape this repo keeps shipping by
 * accident. REVIEW_REQUEST_MAX_AGE_MS (:158) is the same choice — a literal
 * 61h, with cron-coupling.test.ts pinning the derivation.
 *
 * Used twice: as the held subject's `deadline` (hold rather than send past
 * usefulness) and as `releaseAppointmentConfirm`'s own re-check.
 */
export const APPOINTMENT_CONFIRM_MIN_LEAD_MS = (24 * 60 + 15) * 60 * 1000;

/** SMS only, by definition of the recipe ("Reply YES" in an email points at a
 *  no-reply address), so the row carries no email address at all — the type is
 *  how a recipe author is kept from sending this by mail. It also carries no
 *  `smsFailedAt`: this recipe writes its attempt marker and NEVER reads it
 *  back (a 24h cooldown over a 75-minute window is one attempt ever — the text
 *  reminder's recorded bug), and a field that must not be read is best absent. */
export type DueAppointmentConfirm = {
  bookingId: string; accountId: string;
  startsAt: string;
  /** The booker's own zone, captured at booking, for the time in the text —
   *  safeZone(bookerTimezone, accountTimezone), the email reminder's rule. */
  bookerTimezone: string | null;
  contactId: string; contactPhone: string | null;
  brandName: string; accountTimezone: string;
  /** The operator's optional CLOSING line. The ask itself is fixed copy
   *  (appointment-confirm-copy.ts): "either way we'll see it" is the whole
   *  reason there is no reply-back, so it cannot live in an editable field. */
  body: string;
};

const APPOINTMENT_CONFIRM_SELECT =
  "id, account_id, contact_id, starts_at, booker_timezone, contacts(phone)";

function toDueAppointmentConfirm(r: any, info: AccountBrandInfo, auto: EnabledRecipe): DueAppointmentConfirm {
  return {
    bookingId: r.id,
    accountId: r.account_id,
    startsAt: r.starts_at,
    bookerTimezone: r.booker_timezone ?? null,
    contactId: r.contact_id,
    contactPhone: r.contacts?.phone ?? null,
    brandName: brandDisplayName(info.branding),
    accountTimezone: info.accountTimezone,
    body: auto.body,
  };
}

/** No gate follows this list beyond the window: the ask is tied to the
 *  appointment, not to a morning, and quiet hours already holds a 6 AM send
 *  until 08:00. */
export async function listDueAppointmentConfirms(
  db: SupabaseClient, nowIso: string,
): Promise<DueAppointmentConfirm[]> {
  const enabled = await listEnabled(db, "appointment_confirm", "listDueAppointmentConfirms");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + APPOINTMENT_CONFIRM_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + APPOINTMENT_CONFIRM_WINDOW_END_MS).toISOString();

  const { data, error } = await db.from("bookings")
    .select(APPOINTMENT_CONFIRM_SELECT)
    .in("account_id", [...enabled.keys()])
    .eq("status", "booked").is("confirm_asked_at", null)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueAppointmentConfirms failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueAppointmentConfirms");

  return sendable.map((r: any) =>
    toDueAppointmentConfirm(r, accountInfo.get(r.account_id as string)!, enabled.get(r.account_id as string)!));
}

export async function getDueAppointmentConfirmById(
  db: SupabaseClient, bookingId: string,
): Promise<DueLookup<DueAppointmentConfirm>> {
  const { data, error } = await db.from("bookings")
    .select(APPOINTMENT_CONFIRM_SELECT)
    .eq("id", bookingId).eq("status", "booked").is("confirm_asked_at", null).maybeSingle();
  if (error) throw new Error(`getDueAppointmentConfirmById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "appointment_confirm");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(
    db, [data as { account_id: string }], "getDueAppointmentConfirmById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueAppointmentConfirm(data, accountInfo.get((data as any).account_id)!, auto) };
}

/** Send-then-stamp, same reasoning as every other recipe: only after a
 *  confirmed send. This is what stops five copies over the 75-minute window. */
export async function stampAppointmentConfirmAsked(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ confirm_asked_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampAppointmentConfirmAsked failed: ${error.message}`);
}

/** The attempt marker, WRITTEN AND NEVER READ BACK (caps.ts's text-reminder
 *  exemption, for the same reason: a 24h cooldown over a 75-minute window is
 *  one attempt ever). It exists so a failed attempt is visible to the
 *  operator, not so the pass can hold on it. */
export async function stampAppointmentConfirmSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ confirm_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampAppointmentConfirmSmsFailed failed: ${error.message}`);
}

// --- the reply -------------------------------------------------------------

export type ConfirmationAnswer = "yes" | "no";

// The accented member is written as an ESCAPED codepoint, never as an editor
// literal: an editor, a formatter or a git filter that re-saved this file in
// NFD would turn a typed "sí" into s + U+0301, and the set would then
// silently stop matching the composed form the matcher normalises to. A
// \u00ed cannot be decomposed by a save.
const CONFIRM_YES: ReadonlySet<string> = new Set([
  "yes", "y", "si", "s\u00ed" /* sí, COMPOSED. The ESCAPE is the protection:
                                  an editor that re-saves this file in NFD
                                  cannot decompose a codepoint written so. */
  , "confirm", "confirmed",
]);
const CONFIRM_NO: ReadonlySet<string> = new Set(["no", "n", "cancel"]);

/**
 * The WHOLE message, not a word inside it. "yes please, but move it to
 * Friday" is a conversation, not a confirmation, and "I said no problem" is
 * not a cancellation — a substring match would mis-read both, and the second
 * would tell an operator a customer cancelled when they did not.
 *
 * So: normalise (NFC, because "sí" can arrive as s + U+0301 — iOS and some
 * Android keyboards send the decomposed form, and the set above holds the
 * composed one), trim, lowercase, strip TRAILING punctuation and symbols
 * ("yes.", "YES!!", "no 👍"), then test set membership. Anything else returns
 * null and nothing is written at all.
 *
 * TRAILING ONLY, and that is a decision: "¡Sí!" returns null, because the
 * opening "¡" survives the strip. A Spanish speaker who opens with "¡" is
 * writing a sentence, not tapping one word, and widening the strip to both
 * ends would start admitting fragments of sentences — the exact thing the
 * whole-message rule exists to refuse.
 *
 * Pure, and exported on its own so it can be tested without a database.
 */
export function matchConfirmationReply(text: string): ConfirmationAnswer | null {
  const cleaned = text.normalize("NFC").trim().toLowerCase().replace(/[\s\p{P}\p{S}]+$/u, "");
  if (CONFIRM_YES.has(cleaned)) return "yes";
  if (CONFIRM_NO.has(cleaned)) return "no";
  return null;
}

/**
 * Records a customer's one-word answer against the booking the ask went out
 * for. Called from the inbound SMS webhook, in its own try/catch, AFTER the
 * message has been filed — a keyword failure must never discard a customer's
 * message (the getAlertPhone pattern, api/sms/inbound/route.ts:124-128).
 *
 * What it does NOT do, and both are decisions, not omissions:
 *   - it never touches bookings.status. A destructive action from one word in
 *     a text, with no confirmation, is what DESIGN.md rule 6 forbids; the
 *     operator cancels, having read the answer on the booking.
 *   - it never sends anything. A reply-back would make this webhook a sender,
 *     cost a message per confirmation and risk a loop against the carrier's
 *     own STOP handling. The ask's own "either way we'll see it" is what
 *     covers the customer (spec decision 6).
 *
 * "Which booking": the one this contact was asked about MOST RECENTLY and
 * has not answered, among those still `booked` and still in the future.
 *
 * Most recently asked, not soonest starting, because the customer is
 * answering a text — and the text they are holding named a particular day
 * and time (`composeAppointmentConfirm(..., formatWhen(startsAt, zone), ...)`).
 * Two booked jobs less than 48h apart — a two-day job, or a morning slot plus
 * a next-day slot — are asked about on consecutive days, and both asks are
 * outstanding when the second one is answered. Ordering by `starts_at` then
 * writes Sunday's "NO" onto Saturday's job: the operator's calendar reads
 * "Asked for a different time" against the wrong day and Sunday still reads
 * as unanswered. (This function shipped `starts_at` ascending under plan
 * amendment B12; audit B's I2 found the case above and the spec's own Recipe
 * 2 had said "most recent" all along.)
 *
 * The other three predicates are unchanged and each carries its own weight:
 * an appointment that has already started, that was cancelled since the ask
 * went out, or that was never asked about at all is not a thing anyone is
 * confirming. `starts_at` ascending survives only as the TIEBREAK, for two
 * asks stamped in the same millisecond; no single-threaded test can red it,
 * and it is here so `limit(1)` has one answer rather than whichever row the
 * plan happened to emit first.
 *
 * Returns the answer it wrote, or null when it wrote nothing — the route logs
 * the difference and does nothing else with it.
 */
export async function applyConfirmationReply(
  db: SupabaseClient, accountId: string, contactId: string, text: string, now: Date,
): Promise<ConfirmationAnswer | null> {
  const answer = matchConfirmationReply(text);
  if (answer === null) return null;

  const { data, error } = await db.from("bookings")
    .select("id")
    .eq("account_id", accountId).eq("contact_id", contactId)
    // STILL BOOKED. A booking that was asked and then cancelled is not a
    // thing anyone is confirming, and being the sooner of the two it would
    // win the ordering: the answer would land on the scrapped job while the
    // live appointment read as unanswered. `bookings_confirm_reply_pending`
    // (account_id, contact_id, starts_at where confirm_asked_at is not null
    // and confirm_reply is null) still serves this read — an equality on a
    // column the index does not carry is a cheap recheck of the rows it
    // returned, not a lost index.
    .eq("status", "booked")
    .not("confirm_asked_at", "is", null)
    .is("confirm_reply", null)
    .gt("starts_at", now.toISOString())
    // THE ASK THEY ARE ANSWERING. `bookings_confirm_reply_pending` is
    // (account_id, contact_id, starts_at) and no longer supplies this order,
    // so the plan sorts the rows it returns — which is a handful per contact
    // (`.eq("account_id").eq("contact_id")` plus a partial index on the two
    // null-state columns), not a table scan. Correctness over an ordered
    // index read at that size.
    .order("confirm_asked_at", { ascending: false })
    .order("starts_at", { ascending: true })
    .limit(1).maybeSingle();
  if (error) throw new Error(`applyConfirmationReply lookup failed: ${error.message}`);
  if (!data) return null;

  const { data: written, error: uErr } = await db.from("bookings")
    .update({ confirm_reply: answer, confirm_reply_at: now.toISOString() })
    .eq("id", (data as { id: string }).id)
    // Re-scoped by account on the WRITING statement too. Not a live hole —
    // the id came out of the account-scoped SELECT above — but this runs
    // service-role, and a writing statement whose tenancy you have to trace
    // to another query to see is how the next edit loses it.
    .eq("account_id", accountId)
    // COMPARE-AND-SET, and the ONLY thing it can lose to is a second inbound
    // text for the same contact landing between the SELECT and this UPDATE.
    // No test can red this predicate — the SELECT two statements up already
    // excludes answered rows, so single-threaded it always matches. It is
    // defence in depth, and it is said out loud here rather than left looking
    // like a filter someone could prove.
    .is("confirm_reply", null)
    // The row it actually matched, so the return value is a fact rather than
    // a hope: the caller (the inbound SMS route) logs on exactly this value,
    // and the loser of that race must not be reported as a recorded answer.
    .select("id").maybeSingle();
  if (uErr) throw new Error(`applyConfirmationReply write failed: ${uErr.message}`);
  return written ? answer : null;
}

// ---------------------------------------------------------------------------
// Recipe: referral ask — the completed-job ladder's third rung (part B)
// ---------------------------------------------------------------------------

export type ReferralAskChannel = "email" | "sms";
export type ReferralAskConfig = { channel: ReferralAskChannel };

/** jsonb is untrusted on read AND write, the review request's contract.
 *  `null` means "treat as missing" and the pass sends nothing. There is
 *  deliberately NO url field: the referral ask asks for a NAME, never a
 *  rating, and a config with nowhere to put a link is how that stays true. */
export function parseReferralAskConfig(raw: unknown): ReferralAskConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  return { channel };
}

/**
 * The follow-up's 37h, plus one local day for the review request (61h), plus
 * one more for this. Day one "how did it go?", day two "would you leave a
 * review?", day three "know anyone else?" — each rung one strictly-later
 * local day than the last, so the ladder is a ladder and not a pile.
 * cron-coupling.test.ts pins the derivation, as it already pins the 61h.
 */
export const REFERRAL_ASK_MAX_AGE_MS = REVIEW_REQUEST_MAX_AGE_MS + 24 * 60 * 60 * 1000;

export type DueReferralAsk = {
  bookingId: string; accountId: string;
  endsAt: string;
  /** The completion clock (0026); the pass runs from laterOf(endsAt, completedAt). */
  completedAt: string | null;
  /** Rung one's stamp. The gate defers to a strictly later local day. */
  followupSentAt: string | null;
  /** Rung two's stamp. Same deferral — never the same morning as the review. */
  reviewRequestedAt: string | null;
  /** The last FAILED referral text for this booking. Read back (24h cooldown). */
  smsFailedAt: string | null;
  /** THE PRECEDENCE INPUT. When review_request is ON for this account and
   *  `reviewRequestedAt` is still null and the anchor is still inside 61h,
   *  the referral ask WAITS — so the review always goes first, never merely
   *  usually. Resolved here, in the data layer, by a second narrow
   *  `listEnabled` read, because the gate is pure and cannot query. */
  reviewRequestEnabled: boolean;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  body: string;
  config: ReferralAskConfig | null;
};

// ONE string literal, never a `+` concatenation, however long the line gets.
// supabase-js parses the select at the TYPE level off a string LITERAL; a
// concatenated expression is plain `string`, the parser answers
// `GenericStringError`, and the `data as { account_id: string }` cast below
// then fails `tsc` with "neither type sufficiently overlaps". Every other
// *_SELECT in this file is one literal for the same reason.
const REFERRAL_ASK_SELECT =
  "id, account_id, contact_id, ends_at, completed_at, followup_sent_at, review_requested_at, referral_ask_sms_failed_at, contacts(email, phone)";

function toDueReferralAsk(
  r: any, info: AccountBrandInfo, auto: EnabledRecipe, reviewRequestEnabled: boolean,
): DueReferralAsk {
  return {
    bookingId: r.id,
    accountId: r.account_id,
    endsAt: r.ends_at,
    completedAt: r.completed_at ?? null,
    followupSentAt: r.followup_sent_at ?? null,
    reviewRequestedAt: r.review_requested_at ?? null,
    smsFailedAt: r.referral_ask_sms_failed_at ?? null,
    reviewRequestEnabled,
    contactId: r.contact_id,
    contactEmail: r.contacts?.email ?? null,
    contactPhone: r.contacts?.phone ?? null,
    brandName: brandDisplayName(info.branding),
    branding: info.branding,
    accountTimezone: info.accountTimezone,
    fromEmail: info.fromEmail,
    replyToEmail: info.replyToEmail,
    body: auto.body,
    config: parseReferralAskConfig(auto.config),
  };
}

/**
 * Candidates, not decisions: `shouldSendReferralAskNow` decides the MOMENT.
 * The query only says "enabled, completed, unstamped, inside 85h by either
 * anchor". The SECOND `listEnabled` read is the precedence input and costs
 * one narrow indexed query per tick, not one per row.
 *
 * THE INDEXES THAT SERVE IT are its own, added by 0047:
 * `bookings_referral_due` on `(ends_at) where status = 'completed' and
 * referral_asked_at is null` and `bookings_referral_due_completed` on
 * `(completed_at)` with the same predicate — one per anchor, because the
 * `.or(...)` is a union of two ranges. The review request's pair
 * (`bookings_review_due`, `bookings_review_due_completed`) CANNOT serve this
 * query: a partial index is only chosen when its predicate is implied by the
 * query's, and `referral_asked_at is null` does not imply
 * `review_requested_at is null`.
 */
export async function listDueReferralAsks(
  db: SupabaseClient, nowIso: string,
): Promise<DueReferralAsk[]> {
  const enabled = await listEnabled(db, "referral_ask", "listDueReferralAsks");
  if (enabled.size === 0) return [];
  const reviewOn = await listEnabled(db, "review_request", "listDueReferralAsks");

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - REFERRAL_ASK_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select(REFERRAL_ASK_SELECT)
    .in("account_id", [...enabled.keys()])
    .eq("status", "completed").is("referral_asked_at", null)
    .or(eitherAnchorSince("completed_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueReferralAsks failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueReferralAsks");

  return sendable.map((r: any) => toDueReferralAsk(
    r, accountInfo.get(r.account_id as string)!, enabled.get(r.account_id as string)!,
    reviewOn.has(r.account_id as string)));
}

export async function getDueReferralAskById(
  db: SupabaseClient, bookingId: string,
): Promise<DueLookup<DueReferralAsk>> {
  const { data, error } = await db.from("bookings")
    .select(REFERRAL_ASK_SELECT)
    .eq("id", bookingId).eq("status", "completed").is("referral_asked_at", null).maybeSingle();
  if (error) throw new Error(`getDueReferralAskById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const accountId = (data as any).account_id as string;
  const auto = await enabledRecipeFor(db, accountId, "referral_ask");
  if (!auto) return { due: null, why: "off" };
  // A STORED CONFIG THAT NO LONGER PARSES IS `off` FOR A RELEASE, and saying
  // so HERE is what keeps a released row from parking. On a normal tick
  // `processReferralAsks` is silent on `config === null` (the channel is
  // unknown before the config parses, so there is no subject to write
  // against) and that is right — the row is simply examined again next tick.
  // A RELEASED row given the same silence keeps its past `held_until` and is
  // handed back every tick for ever, the parked-row bug. Answering `off`
  // sends `releaseReferralAsk` down its existing `REASONS.recipeOff` path,
  // which writes a real row and takes the hold out of the queue. Same shape
  // as `getDueQuoteFollowupById` (Task 9), and the reason Task 6's releaser
  // can state that its `config === null` branch is unreachable on a release.
  if (parseReferralAskConfig(auto.config) === null) return { due: null, why: "off" };
  // The precedence input, re-read for THIS account: the agency may have
  // turned the review request on during the hold, and a release that ignored
  // that would text a referral ask before the review it must follow.
  const review = await enabledRecipeFor(db, accountId, "review_request");
  const { sendable, accountInfo } = await loadSendableRows(
    db, [data as { account_id: string }], "getDueReferralAskById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueReferralAsk(data, accountInfo.get(accountId)!, auto, review !== null) };
}

/** Send-then-stamp. One referral ask per booking, ever. */
export async function stampReferralAsked(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ referral_asked_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReferralAsked failed: ${error.message}`);
}

/** The ATTEMPT marker, read back by the pass for SMS_RETRY_COOLDOWN_MS. */
export async function stampReferralAskSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ referral_ask_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReferralAskSmsFailed failed: ${error.message}`);
}

/** The daily cap's input, counted off the stamp column itself — no ledger
 *  table and no timezone: "a day" is a rolling 24 hours from the tick.
 *  Served by 0047's `bookings_referral_ask_count` on
 *  `(account_id, referral_asked_at) where referral_asked_at is not null` —
 *  a head-only count that never touches a heap page. */
export async function countReferralAsksSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("referral_asked_at", sinceIso);
  if (error) throw new Error(`countReferralAsksSince failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Recipe: reactivation — a past customer who has gone quiet (part B)
// ---------------------------------------------------------------------------

/**
 * Six to eighteen months, defaulting to nine (danlo, 2026-09-21). Roofing and
 * landscaping are seasonal: nine months reaches someone whose last job was
 * last spring, while the relationship is still warm enough that the message
 * reads as a business they know. Twelve is a full cycle, by which point it
 * reads as a blast from a stranger — which is precisely the risk this recipe
 * carries. The range is narrow for the same reason: three months is too soon
 * to call someone lapsed, two years is a cold list.
 */
export const REACTIVATION_MIN_MONTHS = 6;
export const REACTIVATION_MAX_MONTHS = 18;
export const REACTIVATION_DEFAULT_MONTHS = 9;

/**
 * ONE PAGE of the candidate read. The per-account daily cap is five, so this
 * is not a throughput limit — it is the bound that keeps the follow-up reads
 * (bookings, messages) narrow `.in(...)` queries rather than table scans.
 */
export const REACTIVATION_CANDIDATE_LIMIT = 200;

/**
 * HOW MANY PAGES ONE TICK WILL WALK, and why there is a walk at all.
 *
 * A single page plus client-side eligibility STARVES. The candidate read can
 * only express "this account, quiet since the cutoff, unstamped, has an
 * email" — the completed-booking rule cannot be a predicate on the same
 * query. So a page whose rows are all LEADS (a contact who wrote in, never
 * booked, and never will) survives the query, fails the booking read, and —
 * because the order is deterministic and oldest-first, and nothing ever
 * stamps a row that did not send — occupies the head of the window on EVERY
 * subsequent tick. An account with 200+ old lead conversations would get an
 * empty due-list for ever, with no error and no counter: the same class of
 * bug `release-held.ts` guards against.
 *
 * So the read walks pages until enough rows survive ALL the filters, or the
 * budget is spent. The residual bound is honest and worth stating: an
 * account with more than `LIMIT × PAGES` quiet, unstamped, emailable
 * conversations that have NEVER had a completed booking still starves, and
 * so does one whose pages are filled by a SUPPRESSED account's rows
 * (suppression is applied by `loadSendableRows`, after the page is read). At
 * 200 × 5 that is a thousand, which is far past any trades business this
 * product serves; if a real account reaches it, the counter to raise is
 * PAGES, and the fix after that is a `contacts.last_completed_booking_at`
 * column the candidate query can filter on directly.
 */
export const REACTIVATION_CANDIDATE_PAGES = 5;

/** Enough survivors to fill a tick, so the walk stops early in the normal
 *  case: `AUTOMATION_TICK_CAP` is 10 and the per-account daily cap is 5, so
 *  fifty covers ten accounts' worth of sends before the walk is pointless. */
export const REACTIVATION_SURVIVOR_TARGET = 50;

export type ReactivationConfig = { months: number };

/** jsonb is untrusted on read AND write. A whole number inside the range or
 *  null; no clamping, because silently turning a typo'd 99 into 18 would show
 *  the operator one number and send on another. */
export function parseReactivationConfig(raw: unknown): ReactivationConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { months } = raw as Record<string, unknown>;
  if (typeof months !== "number" || !Number.isInteger(months)) return null;
  if (months < REACTIVATION_MIN_MONTHS || months > REACTIVATION_MAX_MONTHS) return null;
  return { months };
}

/**
 * `now` minus whole CALENDAR months, clamped to the end of the target month.
 * Calendar months, not 30-day blocks, because "nine months" is what the
 * operator typed and what the card says. The clamp is what stops 31 August
 * minus six months becoming 3 March: `setUTCMonth` rolls a day that does not
 * exist in the target month forward, silently.
 *
 * UTC throughout: this produces a CUTOFF for a `timestamptz` comparison, not
 * a wall clock a person reads, so there is no zone to be wrong about.
 */
export function reactivationCutoff(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTarget));
  return d;
}

/** Email only in v1 (spec decision 4): there is no per-contact SMS consent in
 *  this schema — `contacts.dnd` is dead and the opt-out mechanism is Telnyx's
 *  carrier-side STOP list — and "we haven't seen you in a while" is marketing,
 *  not customer care, against an A2P campaign that does not exist yet. The
 *  row therefore carries no phone number at all. */
export type DueReactivation = {
  contactId: string; accountId: string;
  /** What `conversations.last_message_at` CLAIMED at the moment this row was
   *  built. Carried for the pass's console line on the heard-back skip: when
   *  the exact re-check disagrees with this column, that line is the only
   *  place the lag is visible. There is deliberately NO `conversationId` —
   *  nothing downstream takes one (`conversationQuietSince` looks the
   *  conversation up from the contact), and a field nobody reads is a field
   *  that drifts. */
  lastMessageAt: string;
  /** This account's configured quiet period, carried so the release can
   *  re-derive the same cutoff without re-reading the config. */
  quietMonths: number;
  contactEmail: string;
  /** For the greeting. Never `accounts.name`. */
  contactName: string;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  body: string;
};

/** One page's worth of candidate conversation, contact already joined.
 *
 *  `contacts.account_id` is selected for ONE reason: to be compared with the
 *  conversation's. `conversations.contact_id` is a plain single-column FK —
 *  there is no composite `(account_id, contact_id)` key on `conversations`,
 *  `bookings` or `opportunities` — so a conversation in account A can point
 *  at a contact of account B, and this recipe resolved the customer, the
 *  email address and the "past customer" proof through `contact_id` alone. */
type ReactivationCandidate = {
  id: string; account_id: string; contact_id: string; last_message_at: string;
  contacts: {
    id: string; account_id: string;
    first_name: string | null; last_name: string | null; email: string;
  };
};

/**
 * ONE read up front, then THREE PER PAGE, and every predicate that CAN be
 * server-side is.
 *
 *   1. (once) which accounts have the recipe on, and with what config;
 *   2. conversations quiet since the WIDEST cutoff, oldest first, one page at
 *      a time, with `contacts!inner(...)` carrying the two contact
 *      predicates — unstamped and has an email — INTO the same query
 *      (`calendars!inner` + `.eq("calendars.followup_enabled", true)` in
 *      `booking.ts`'s `listDueFollowups` is the precedent for the shape);
 *   3. bookings: at least one COMPLETED — the rule that stops this being a
 *      blast, and it is a query predicate, not a hope. It cannot join onto
 *      read 2 (there is no path from `conversations` to `bookings`), so it is
 *      the one eligibility test that stays client-side, and it is the reason
 *      the candidate read WALKS PAGES instead of taking one;
 *   4. messages: the lagging-touch PRE-FILTER. `createMessage` touches
 *      `conversations.last_message_at` best-effort and non-fatally
 *      (messaging.ts), so the column can LAG reality.
 *
 * WHY `months` STAYS CLIENT-SIDE (amendment B5's real argument): it is
 * PER-ACCOUNT config, and one query cannot carry four different cutoffs. So
 * the widest (latest, most permissive) cutoff goes to Postgres and each row
 * is then narrowed to its OWN account's. Pushing the contact predicates into
 * the query does not touch that split.
 *
 * WHY THE MESSAGE READ QUERIES THE EARLIEST CUTOFF, NOT THE WIDEST: the
 * question is "does this conversation have a message newer than THIS
 * account's cutoff", and an account with a LONGER quiet period has an
 * EARLIER cutoff, so `> widest` would miss exactly the messages that matter
 * to it. Concrete: account A is set to 18 months, account B to 6; `widest` is
 * B's cutoff; a contact of A who last wrote ten months ago is newer than A's
 * cutoff but older than B's, and a `> widest` read would not see the message
 * at all — A's customer would then be told "it's been a while since we were
 * out at your place" ten months after writing in. So the read is
 * `> earliest` (a superset for every account) and each row is compared to
 * its OWN account's cutoff.
 *
 * AND THE READ IS A PRE-FILTER, NOT THE GUARD. Its `.limit()` bounds MESSAGE
 * ROWS, not conversations, so one chatty conversation can consume the whole
 * page's budget and leave the others unchecked. That is survivable — and only
 * survivable — because `processReactivations` calls `conversationQuietSince`
 * EXACTLY, per row, immediately before sending. A miss here can only let a
 * not-quiet row through to that check; it can never drop a quiet one.
 */
export async function listDueReactivations(
  db: SupabaseClient, nowIso: string,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<DueReactivation[]> {
  const enabled = await listEnabled(db, "reactivation", "listDueReactivations");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso);
  // Per-account cutoffs. A config that does not parse SKIPS THE ACCOUNT —
  // `null` means "treat as missing and send nothing", the contract every
  // other recipe keeps (`parseReviewRequestConfig`'s doc above).
  // Defaulting to nine months here would send on a number the operator never
  // chose, for the one recipe with spam teeth.
  const cutoffs = new Map<string, { cutoff: Date; months: number; body: string }>();
  for (const [accountId, auto] of enabled) {
    const config = parseReactivationConfig(auto.config);
    if (config === null) {
      console.error(
        `listDueReactivations: account ${accountId}'s reactivation config is missing or invalid `
        + `— skipping the account rather than sending on a default nobody chose`,
      );
      continue;
    }
    cutoffs.set(accountId, {
      cutoff: reactivationCutoff(now, config.months), months: config.months, body: auto.body,
    });
  }
  if (cutoffs.size === 0) return [];

  const accountIds = [...cutoffs.keys()];
  const cutoffTimes = [...cutoffs.values()].map((c) => c.cutoff.getTime());
  const widest = new Date(Math.max(...cutoffTimes));     // latest — the query's superset
  const earliest = new Date(Math.min(...cutoffTimes));   // earliest — the message read's superset

  const pageSize = opts.pageSize ?? REACTIVATION_CANDIDATE_LIMIT;
  const maxPages = opts.maxPages ?? REACTIVATION_CANDIDATE_PAGES;
  const out: DueReactivation[] = [];

  for (let page = 0; page < maxPages && out.length < REACTIVATION_SURVIVOR_TARGET; page++) {
    const from = page * pageSize;
    // `conversations_account_recent (account_id, last_message_at desc nulls
    // last)` (0005) serves the account + range + order; a DESC index scans
    // backward for an ASC order at no cost. `id` is the tiebreaker, without
    // which two conversations sharing a `last_message_at` could swap places
    // between pages and one of them would never be read.
    const { data: convos, error: cErr } = await db.from("conversations")
      .select("id, account_id, contact_id, last_message_at, contacts!inner(id, account_id, first_name, last_name, email)")
      .in("account_id", accountIds)
      .lte("last_message_at", widest.toISOString())
      .is("contacts.reactivation_sent_at", null)
      .not("contacts.email", "is", null)
      .order("last_message_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (cErr) throw new Error(`listDueReactivations conversations read failed: ${cErr.message}`);

    const rows = (convos ?? []) as unknown as ReactivationCandidate[];
    if (rows.length === 0) break;

    // Narrow each candidate to ITS OWN account's cutoff. A null
    // `last_message_at` never reaches here (`lte` excludes nulls), which is
    // right: a conversation with no messages says nothing about how long it
    // has been.
    //
    // AND to its own account's CONTACT. The embed crosses
    // `conversations_contact_id_fkey`, which carries no account condition of
    // its own, so a conversation in account A pointing at a contact of
    // account B joins in B's name and email address — and everything
    // downstream (the send, and the permanent `reactivation_sent_at` stamp)
    // then happens to B's customer under A's brand. There is no composite
    // `(account_id, contact_id)` key to express this in the database, so it
    // is expressed here.
    const candidates = rows.filter(
      (c) => c.contacts.account_id === c.account_id
        && new Date(c.last_message_at).getTime() <= cutoffs.get(c.account_id)!.cutoff.getTime());

    if (candidates.length > 0) {
      // THE ANTI-BLAST RULE. Not "a contact", not "a lead" — someone whose
      // job this company actually completed. Served by 0047's
      // `bookings_completed_by_contact` on `(contact_id) where status =
      // 'completed'`; before it there was no index on `bookings.contact_id`
      // at all and this was a sequential scan every tick.
      //
      // ACCOUNT-KEYED, not contact-keyed. `bookings.contact_id` is another
      // plain FK, so account A's completed booking for contact X would
      // otherwise prove that X is account B's past customer. The set key is
      // the PAIR, and `.in("account_id", accountIds)` keeps the read itself
      // inside the recipe's own accounts.
      const { data: done, error: bErr } = await db.from("bookings")
        .select("contact_id, account_id")
        .in("account_id", accountIds)
        .in("contact_id", candidates.map((c) => c.contact_id))
        .eq("status", "completed");
      if (bErr) throw new Error(`listDueReactivations bookings read failed: ${bErr.message}`);
      const customerKey = (accountId: string, contactId: string) => `${accountId}:${contactId}`;
      const customers = new Set(((done ?? []) as { contact_id: string; account_id: string }[])
        .map((b) => customerKey(b.account_id, b.contact_id)));

      // `account_id` is in the filter so `messages_thread (account_id,
      // conversation_id, created_at)` (0005) can be used — without a
      // constraint on the leading column it cannot be.
      const { data: recent, error: mErr } = await db.from("messages")
        .select("conversation_id, created_at")
        .in("account_id", accountIds)
        .in("conversation_id", candidates.map((c) => c.id))
        .gt("created_at", earliest.toISOString())
        .limit(REACTIVATION_CANDIDATE_LIMIT);
      if (mErr) throw new Error(`listDueReactivations messages read failed: ${mErr.message}`);
      const newestByConversation = new Map<string, number>();
      for (const r of (recent ?? []) as { conversation_id: string; created_at: string }[]) {
        const t = new Date(r.created_at).getTime();
        const seen = newestByConversation.get(r.conversation_id);
        if (seen === undefined || t > seen) newestByConversation.set(r.conversation_id, t);
      }

      const surviving = candidates.filter((c) => {
        if (!customers.has(customerKey(c.account_id, c.contact_id))) return false;
        const newest = newestByConversation.get(c.id);
        // Compared to THIS account's cutoff, never to `earliest`.
        return newest === undefined || newest <= cutoffs.get(c.account_id)!.cutoff.getTime();
      });

      if (surviving.length > 0) {
        // NO CAST on `surviving`. The loader below is generic over
        // `T extends { account_id: string }` (`booking.ts`), so casting the
        // argument to `{ account_id: string }[]` pins `T` to exactly that
        // and erases `contact_id`, `id` and `last_message_at` from
        // `sendable`. (The loader is deliberately not NAMED in this comment:
        // `outbound-suppressed.test.ts` walks this file per function and
        // asks whether the body mentions it, so a comment carrying the name
        // would satisfy that walk with the call itself deleted.)
        const { sendable, accountInfo } = await loadSendableRows(
          db, surviving, "listDueReactivations");

        for (const c of sendable) {
          const info = accountInfo.get(c.account_id)!;
          const conf = cutoffs.get(c.account_id)!;
          out.push({
            contactId: c.contact_id, accountId: c.account_id,
            lastMessageAt: c.last_message_at, quietMonths: conf.months,
            contactEmail: c.contacts.email,
            contactName: [c.contacts.first_name, c.contacts.last_name].filter(Boolean).join(" ").trim(),
            brandName: brandDisplayName(info.branding), branding: info.branding,
            accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
            body: conf.body,
          });
        }
      }
    }

    if (rows.length < pageSize) break;   // the end of the data, not the budget
  }

  return out;
}

/**
 * The release's re-read. It does NOT apply the quiet test: the releaser
 * applies it separately, through `conversationQuietSince`, so that "they
 * wrote in during the hold" gets its own client-readable reason instead of a
 * flat "No longer due".
 */
export async function getDueReactivationById(
  db: SupabaseClient, contactId: string,
): Promise<DueLookup<DueReactivation>> {
  const { data: contact, error } = await db.from("contacts")
    .select("id, account_id, first_name, last_name, email, reactivation_sent_at")
    .eq("id", contactId).is("reactivation_sent_at", null).not("email", "is", null).maybeSingle();
  if (error) throw new Error(`getDueReactivationById failed: ${error.message}`);
  if (!contact) return { due: null, why: "gone" };
  const accountId = (contact as { account_id: string }).account_id;

  const auto = await enabledRecipeFor(db, accountId, "reactivation");
  if (!auto) return { due: null, why: "off" };
  // A config that does not parse is `off`, never a default: `null` means
  // "treat as missing and send nothing", and a release that fell back to
  // nine months would send on a number the operator never chose. Answering
  // `off` also keeps the released row from parking — `releaseReactivation`
  // writes `REASONS.recipeOff` and the hold leaves the queue.
  const config = parseReactivationConfig(auto.config);
  if (config === null) return { due: null, why: "off" };

  // `.eq("account_id", accountId)` — the contact's own account, read off the
  // contact two statements up. Without it another account's completed
  // booking proves this account's "past customer" rule, because
  // `bookings.contact_id` is a plain FK with no account condition on it.
  const { data: done, error: bErr } = await db.from("bookings")
    .select("id").eq("account_id", accountId)
    .eq("contact_id", contactId).eq("status", "completed").limit(1).maybeSingle();
  if (bErr) throw new Error(`getDueReactivationById bookings read failed: ${bErr.message}`);
  if (!done) return { due: null, why: "gone" };

  const { data: convo, error: cErr } = await db.from("conversations")
    .select("id, last_message_at").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (cErr) throw new Error(`getDueReactivationById conversation read failed: ${cErr.message}`);
  if (!convo || !(convo as { last_message_at: string | null }).last_message_at) return { due: null, why: "gone" };

  const { sendable, accountInfo } = await loadSendableRows(
    db, [{ account_id: accountId }], "getDueReactivationById");
  if (sendable.length === 0) return { due: null, why: "off" };

  const c = contact as { first_name: string | null; last_name: string | null; email: string };
  const info = accountInfo.get(accountId)!;
  return {
    due: {
      contactId, accountId,
      lastMessageAt: (convo as { last_message_at: string }).last_message_at,
      quietMonths: config.months,
      contactEmail: c.email,
      contactName: [c.first_name, c.last_name].filter(Boolean).join(" ").trim(),
      brandName: brandDisplayName(info.branding), branding: info.branding,
      accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
      body: auto.body,
    },
  };
}

/**
 * True when this contact's conversation carries NO message — in either
 * direction — newer than `sinceIso`. THE EXACT CHECK, and it runs twice:
 * once per row in `processReactivations` immediately before the send, and
 * again in `releaseReactivation`. Somebody who wrote in (or was written to)
 * must never then receive "it's been a while since we were out at your
 * place".
 *
 * It is exact where the due-list's bulk message read is only a PRE-FILTER:
 * that read is bounded by a row limit and answers for a page of
 * conversations at once, so a chatty conversation can crowd the others out
 * of its results. This one is scoped to a single conversation and takes no
 * limit, and `messages_thread (account_id, conversation_id, created_at)`
 * (0005) answers it from the index alone.
 *
 * Reads `messages`, not `conversations.last_message_at`, because that
 * column's touch is best-effort and can lag (messaging.ts). Both directions
 * count, because an operator who texted them last night has a live
 * relationship this recipe must not talk over.
 */
export async function conversationQuietSince(
  db: SupabaseClient, accountId: string, contactId: string, sinceIso: string,
): Promise<boolean> {
  const { data: convo, error } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`conversationQuietSince failed: ${error.message}`);
  if (!convo) return true;   // no conversation at all is as quiet as it gets
  const { count, error: mErr } = await db.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("conversation_id", (convo as { id: string }).id)
    .gt("created_at", sinceIso);
  if (mErr) throw new Error(`conversationQuietSince messages read failed: ${mErr.message}`);
  return (count ?? 0) === 0;
}

/** Send-then-stamp. ONE reactivation per contact, EVER — and this column is
 *  the off switch that outlives the toggle: turning the recipe off mid-drain
 *  strands nothing, because the stamp is permanent.
 *
 *  "EVER" is enforced AGAINST THE CRON, not against the client role.
 *  `contacts` carries a table-level UPDATE grant to `authenticated` and
 *  `contacts_member_all` is ALL to `authenticated`, so a logged-in user of
 *  the account can clear `reactivation_sent_at` and make the contact
 *  sendable again — unlike every earlier permanent stamp, which sat on
 *  `bookings`, whose `authenticated` UPDATE 0016 revoked. Same for
 *  `opportunities.quote_followup_sent_at`. 0047's header records the grants
 *  this rests on. */
export async function stampReactivationSent(db: SupabaseClient, contactId: string): Promise<void> {
  const { error } = await db.from("contacts")
    .update({ reactivation_sent_at: new Date().toISOString() })
    .eq("id", contactId);
  if (error) throw new Error(`stampReactivationSent failed: ${error.message}`);
}

/** The input to REACTIVATION_DAILY_CAP — five per account per rolling day,
 *  its own cap and not the platform's 25 (25 a day is 750 people a month who
 *  did not just interact with the business, which is a blast). Served by
 *  0047's `contacts_reactivation_count` on
 *  `(account_id, reactivation_sent_at) where reactivation_sent_at is not null`. */
export async function countReactivationsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("reactivation_sent_at", sinceIso);
  if (error) throw new Error(`countReactivationsSince failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Recipe: quote follow-up — a quoted lead that went quiet (part B)
// ---------------------------------------------------------------------------

/** A month. A 7 AM text about a quote sent five weeks ago reads as a mistake,
 *  and the operator has almost certainly moved the card by then anyway. */
export const QUOTE_FOLLOWUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const QUOTE_FOLLOWUP_MIN_QUIET_DAYS = 1;
export const QUOTE_FOLLOWUP_MAX_QUIET_DAYS = 30;
export const QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS = 3;

/**
 * How many parked deals one tick will look at. The reactivation recipe's
 * `REACTIVATION_CANDIDATE_LIMIT` bounds its candidate read the same way, but
 * for a DIFFERENT residual: that one WALKS pages, because its disqualifier (no
 * completed booking) is permanent and would otherwise park the window for
 * ever. This one needs no walk — see the head-drain note below.
 *
 * THIS RECIPE'S TRIGGER IS A RESTING STATE, not an event: a card sits in the
 * nominated stage for up to thirty days, so an account whose "Quote Sent"
 * column holds hundreds of open deals yields hundreds of rows on EVERY tick —
 * and every contact id on them goes into an `.in("contact_id", …)` and then an
 * `.in("conversation_id", …)`. A PostgREST GET carrying that many uuids fails,
 * and a throw here fails the whole tick for every account, not just this one.
 * `AUTOMATION_TICK_CAP` does not help: it is applied inside the PASS, after
 * this read has already been made.
 *
 * Rows beyond the limit are the next tick's — the query orders oldest stage
 * change first, so the overflow drains from the front. What drains the HEAD is
 * `QUOTE_FOLLOWUP_MAX_AGE_MS`: a row the quiet test keeps refusing (they
 * replied) stays unstamped and keeps its place until it ages out at thirty
 * days. That is the bound; do not claim "nobody starves" here.
 */
export const QUOTE_FOLLOWUP_CANDIDATE_LIMIT = 200;

/**
 * How many inbound messages the quiet test will scan. Ordered newest first, so
 * within one contact the answer never changes; the limit can only drop a
 * contact whose latest inbound is older than 1,000 others in the candidate
 * set's window — and that errs towards SENDING, which is why it is generous
 * (five times the candidate limit) rather than tight. It exists so one very
 * busy account cannot make this read unbounded.
 */
const QUOTE_FOLLOWUP_INBOUND_SCAN_LIMIT = 1000;

export type QuoteFollowupChannel = "email" | "sms";
export type QuoteFollowupConfig = { stageId: string; quietDays: number; channel: QuoteFollowupChannel };

/**
 * jsonb is untrusted on read AND write. `stageId` is the id of one of THIS
 * account's `pipeline_stages` rows — free text per account (0003), so there
 * is no platform-wide "Quoted" stage to hard-code and the operator picks one.
 * Validated as a shape here; that it still BELONGS to the account is a
 * question only a query can answer, and the card asks it (see Task 10).
 */
export function parseQuoteFollowupConfig(raw: unknown): QuoteFollowupConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { stageId, quietDays, channel } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  if (typeof stageId !== "string") return null;
  const id = stageId.trim();
  // The shape Postgres will accept as a uuid. A junk string would otherwise
  // reach the `.in("stage_id", …)` filter and make PostgREST return a 400 for
  // the WHOLE tick, taking every other account's rows with it.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  if (typeof quietDays !== "number" || !Number.isInteger(quietDays)) return null;
  if (quietDays < QUOTE_FOLLOWUP_MIN_QUIET_DAYS || quietDays > QUOTE_FOLLOWUP_MAX_QUIET_DAYS) return null;
  return { stageId: id, quietDays, channel };
}

export type DueQuoteFollowup = {
  opportunityId: string; accountId: string;
  /** The opportunity's CURRENT stage, and what the recipe watches. Equal by
   *  construction in the due-list; compared by the RELEASER, which is the
   *  only place they can have drifted. */
  stageId: string; configStageId: string;
  stageChangedAt: string; quietDays: number;
  smsFailedAt: string | null;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  /** The operator's prose. NEVER the deal's own `name` — "Smith reroof —
   *  maybe" is the operator's internal words, the same class of leak
   *  `accounts.name` is, and this row has no field for it. */
  body: string;
  config: QuoteFollowupConfig | null;
};

// ONE STRING LITERAL, never a concatenation: supabase-js parses the select at
// the TYPE level off a string literal, so `"a, " + "b"` is plain `string`, the
// parser answers `GenericStringError`, and the `data as {...}` below fails with
// TS2352. Task 5 hit this and every other *_SELECT in the file is a single
// literal for the same reason.
const QUOTE_FOLLOWUP_SELECT =
  "id, account_id, contact_id, stage_id, stage_changed_at, quote_followup_sms_failed_at, contacts(email, phone)";

/**
 * Latest INBOUND message per contact since `sinceIso` — the "they already
 * replied" test the opportunities query cannot express. Two narrow reads,
 * bounded by the candidate list (`QUOTE_FOLLOWUP_CANDIDATE_LIMIT`) and by
 * `QUOTE_FOLLOWUP_INBOUND_SCAN_LIMIT`, so this is one pair of reads per tick
 * and not one per row.
 *
 * Exported because the RELEASE needs the single-contact case: a customer who
 * replied during a hold must not be chased at 8 AM.
 *
 * `accountIds` IS A LIST, not one id, because the tick's call covers every
 * account whose quote_followup is on — `listDueQuoteFollowups` deliberately
 * makes one pair of reads for the whole candidate set rather than a pair per
 * account. The release path passes `[row.accountId]`.
 *
 * It buys the index unconditionally: every usable index on these two tables
 * leads with `account_id` (`messages_thread`,
 * `conversations_account_contact_unique`, `conversations_account_recent`)
 * and PostgreSQL 17 has no skip scan, so without a constraint on that
 * leading column both reads were sequential scans. `listDueReactivations`
 * states the same rule over the same two tables.
 *
 * It buys TENANCY only on the release path, where `accountIds` is a single
 * account. On the TICK path `accountIds` is every enabled account and the
 * map below is keyed by `contactId` ALONE, so a cross-account
 * `conversations` row can still let account A's inbound suppress account
 * B's follow-up for a contact both happen to know of (fail-safe: it can
 * only make a due row wait, never send one early). The stronger fix — key
 * the map by the `(account_id, contact_id)` pair, the way
 * `listDueReactivations`' `customerKey` already does — is a follow-up, not
 * done here.
 */
export async function latestInboundByContact(
  db: SupabaseClient, accountIds: readonly string[], contactIds: readonly string[], sinceIso: string,
): Promise<Map<string, string>> {
  if (contactIds.length === 0 || accountIds.length === 0) return new Map();
  const { data: convos, error } = await db.from("conversations")
    .select("id, contact_id")
    .in("account_id", [...accountIds])
    .in("contact_id", [...contactIds]);
  if (error) throw new Error(`latestInboundByContact conversations read failed: ${error.message}`);
  const byConversation = new Map(((convos ?? []) as { id: string; contact_id: string }[])
    .map((c) => [c.id, c.contact_id] as const));
  if (byConversation.size === 0) return new Map();

  const { data: msgs, error: mErr } = await db.from("messages")
    .select("conversation_id, created_at")
    .in("account_id", [...accountIds])
    .in("conversation_id", [...byConversation.keys()])
    .eq("direction", "inbound")
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(QUOTE_FOLLOWUP_INBOUND_SCAN_LIMIT);
  if (mErr) throw new Error(`latestInboundByContact messages read failed: ${mErr.message}`);

  const latest = new Map<string, string>();
  for (const msg of (msgs ?? []) as { conversation_id: string; created_at: string }[]) {
    const contactId = byConversation.get(msg.conversation_id);
    if (!contactId) continue;
    // Ordered newest first, so the first one wins.
    if (!latest.has(contactId)) latest.set(contactId, msg.created_at);
  }
  return latest;
}

/**
 * Candidates, then the quiet test the query cannot express.
 *
 * `stage_id` and `quietDays` are BOTH per-account config, so the query gets
 * the union of the stage ids (exact — uuids do not collide across accounts)
 * and the WIDEST quiet cutoff, and each row is then narrowed to its own
 * account's. `stage_changed_at` is written by both `moveOpportunityStage` and
 * `moveOpportunityToStage` (opportunities.ts:45-46, 65-66), so "parked in the
 * stage you nominate, and how long ago" is a real column and not an
 * inference.
 *
 * The index that serves this read is `opps_quote_followup_due`
 * (0047, `(account_id, stage_id, stage_changed_at) where quote_followup_sent_at
 * is null and status = 'open'`) — its predicate is implied by this query's, in
 * that direction only. BOUNDED by `QUOTE_FOLLOWUP_CANDIDATE_LIMIT`: read that
 * constant's comment before removing the `.limit(...)`.
 */
export async function listDueQuoteFollowups(
  db: SupabaseClient, nowIso: string,
): Promise<DueQuoteFollowup[]> {
  const enabled = await listEnabled(db, "quote_followup", "listDueQuoteFollowups");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const configured = new Map<string, { config: QuoteFollowupConfig; quietCutoff: number; body: string }>();
  for (const [accountId, auto] of enabled) {
    const config = parseQuoteFollowupConfig(auto.config);
    // An invalid config cannot even be queried for — there is no stage id to
    // filter on — so it is dropped here rather than surviving as a row the
    // pass would have to refuse. Logged, because an operator believes this
    // recipe is on.
    if (!config) {
      console.error(
        `listDueQuoteFollowups: account ${accountId} has quote_followup enabled with an invalid `
        + `config — re-save the recipe in Automations`,
      );
      continue;
    }
    configured.set(accountId, {
      config, quietCutoff: now - config.quietDays * DAY, body: auto.body,
    });
  }
  if (configured.size === 0) return [];

  const widestQuiet = new Date(Math.max(...[...configured.values()].map((c) => c.quietCutoff)));
  const oldest = new Date(now - QUOTE_FOLLOWUP_MAX_AGE_MS);

  const { data, error } = await db.from("opportunities")
    .select(QUOTE_FOLLOWUP_SELECT)
    .in("account_id", [...configured.keys()])
    .in("stage_id", [...configured.values()].map((c) => c.config.stageId))
    .eq("status", "open").is("quote_followup_sent_at", null)
    .lte("stage_changed_at", widestQuiet.toISOString())
    .gte("stage_changed_at", oldest.toISOString())
    .order("stage_changed_at", { ascending: true })
    .limit(QUOTE_FOLLOWUP_CANDIDATE_LIMIT);
  if (error) throw new Error(`listDueQuoteFollowups failed: ${error.message}`);

  // Narrow each row to ITS OWN account's stage and quiet period. The stage
  // check is belt-and-braces against the `.in(...)` union — and it is also
  // what keeps one account's stage id from ever selecting another's row.
  const rows = ((data ?? []) as any[]).filter((r) => {
    const conf = configured.get(r.account_id);
    if (!conf) return false;
    if (r.stage_id !== conf.config.stageId) return false;
    return new Date(r.stage_changed_at).getTime() <= conf.quietCutoff;
  });
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueQuoteFollowups");
  if (sendable.length === 0) return [];

  // THE QUIET TEST. Any inbound message since the stage changed means this
  // person is already talking to the business, and a "just checking you got
  // the quote" text would land on top of that conversation. One read pair for
  // the whole candidate set, since the earliest stage change among them.
  const earliest = sendable
    .map((r: any) => new Date(r.stage_changed_at).getTime())
    .reduce((a: number, b: number) => Math.min(a, b));
  const inbound = await latestInboundByContact(
    db, [...configured.keys()], sendable.map((r: any) => r.contact_id as string),
    new Date(earliest).toISOString());

  return sendable
    .filter((r: any) => {
      const replied = inbound.get(r.contact_id as string);
      return !replied || new Date(replied).getTime() <= new Date(r.stage_changed_at).getTime();
    })
    .map((r: any) => {
      const conf = configured.get(r.account_id as string)!;
      const info = accountInfo.get(r.account_id as string)!;
      return {
        opportunityId: r.id, accountId: r.account_id,
        stageId: r.stage_id, configStageId: conf.config.stageId,
        stageChangedAt: r.stage_changed_at, quietDays: conf.config.quietDays,
        smsFailedAt: r.quote_followup_sms_failed_at ?? null,
        contactId: r.contact_id,
        contactEmail: r.contacts?.email ?? null, contactPhone: r.contacts?.phone ?? null,
        brandName: brandDisplayName(info.branding), branding: info.branding,
        accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
        body: conf.body, config: conf.config,
      };
    });
}

/**
 * The release's re-read. It does NOT compare the opportunity's stage with the
 * configured one: the releaser does, so that "the stage this automation
 * watches is gone" gets its own client-readable reason. Both ids are on the
 * row for exactly that comparison.
 */
export async function getDueQuoteFollowupById(
  db: SupabaseClient, opportunityId: string,
): Promise<DueLookup<DueQuoteFollowup>> {
  const { data, error } = await db.from("opportunities")
    .select(QUOTE_FOLLOWUP_SELECT)
    .eq("id", opportunityId).eq("status", "open").is("quote_followup_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueQuoteFollowupById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const accountId = (data as any).account_id as string;
  const auto = await enabledRecipeFor(db, accountId, "quote_followup");
  if (!auto) return { due: null, why: "off" };
  const config = parseQuoteFollowupConfig(auto.config);
  if (!config) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(
    db, [data as { account_id: string }], "getDueQuoteFollowupById");
  if (sendable.length === 0) return { due: null, why: "off" };
  const r = data as any;
  const info = accountInfo.get(accountId)!;
  return {
    due: {
      opportunityId: r.id, accountId,
      stageId: r.stage_id, configStageId: config.stageId,
      stageChangedAt: r.stage_changed_at, quietDays: config.quietDays,
      smsFailedAt: r.quote_followup_sms_failed_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null, contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding), branding: info.branding,
      accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
      body: auto.body, config,
    },
  };
}

/** Send-then-stamp. One quote follow-up per opportunity, EVER — re-arming
 *  when a card re-enters the stage is recorded out of scope for v1. */
export async function stampQuoteFollowupSent(db: SupabaseClient, opportunityId: string): Promise<void> {
  const { error } = await db.from("opportunities")
    .update({ quote_followup_sent_at: new Date().toISOString() })
    .eq("id", opportunityId);
  if (error) throw new Error(`stampQuoteFollowupSent failed: ${error.message}`);
}

/** The ATTEMPT marker, read back by the pass for SMS_RETRY_COOLDOWN_MS. */
export async function stampQuoteFollowupSmsFailed(db: SupabaseClient, opportunityId: string): Promise<void> {
  const { error } = await db.from("opportunities")
    .update({ quote_followup_sms_failed_at: new Date().toISOString() })
    .eq("id", opportunityId);
  if (error) throw new Error(`stampQuoteFollowupSmsFailed failed: ${error.message}`);
}

export async function countQuoteFollowupsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("quote_followup_sent_at", sinceIso);
  if (error) throw new Error(`countQuoteFollowupsSince failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Recipe: instant reply to a new web-form lead (Milestone C — INLINE, not cron)
// ---------------------------------------------------------------------------

/**
 * TWO bodies: English lives in `automations.body` — the column every recipe
 * treats as "the text that sends" — and Spanish lives here. The submission's
 * locale picks. No channel (the recipe IS a text), no link, no window: the
 * form action calls the send path the moment a submission lands
 * (apps/web/src/lib/automations/instant-reply.ts), so there is no due-list
 * and no `listEnabled` shape for this recipe — the inline read is
 * `getAutomation(db, accountId, "instant_reply")`, one row.
 */
export type InstantReplyConfig = { bodyEs: string };

/** Same contract as parseReviewRequestConfig: validated on read AND write,
 *  null means "treat as missing". Length is the save action's business
 *  (AUTOMATION_BODY_MAX_LENGTH lives in the web app); this checks shape. */
export function parseInstantReplyConfig(raw: unknown): InstantReplyConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { bodyEs } = raw as Record<string, unknown>;
  if (typeof bodyEs !== "string") return null;
  return { bodyEs };
}

/**
 * SEND-THEN-STAMP, on the SUBMISSION row (0027): one text per submission at
 * most, and the count the daily cap reads. Not the double-text guard — that
 * is the 24h per-thread hold the send path reads through
 * hasRecentOutboundSms — so a missed stamp undercounts by one and re-texts
 * no one, which is why the inline caller does not retry it.
 */
export async function stampInstantReplySent(db: SupabaseClient, submissionId: string): Promise<void> {
  const { error } = await db.from("form_submissions")
    .update({ instant_reply_sent_at: new Date().toISOString() })
    .eq("id", submissionId);
  if (error) throw new Error(`stampInstantReplySent failed: ${error.message}`);
}

/** The daily cap's input (AUTOMATION_DAILY_CAP over DAILY_CAP_WINDOW_MS):
 *  this account's stamps at or after `sinceIso`. Index-only through
 *  form_submissions_instant_reply_sent (0027). */
export async function countInstantRepliesSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("instant_reply_sent_at", sinceIso);
  if (error) throw new Error(`countInstantRepliesSince failed: ${error.message}`);
  return count ?? 0;
}
