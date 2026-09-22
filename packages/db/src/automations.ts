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
  | "appointment_confirm" | "referral_ask";

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
 * "Which booking": the SOONEST UPCOMING STILL-BOOKED one this contact was
 * asked about and has not answered. Soonest rather than most recently asked,
 * because that is the appointment the customer has in mind when they reply;
 * an appointment that has already started, or that has been cancelled since
 * the ask went out, is not a thing anyone is confirming.
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
