import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { newPublicId, ALPHABET } from "./forms";
import type { Branding } from "./branding";

export type CalendarRow = {
  id: string; account_id: string; public_id: string; enabled: boolean;
  slot_duration_minutes: number; buffer_minutes: number;
  min_notice_hours: number; max_advance_days: number;
  open_hours: Record<string, [string, string][]>;
  notify_emails: string[];
  meeting_type: "in_person" | "phone" | "video";
  followup_enabled: boolean; followup_body: string;
};

export type BookingStatus = "booked" | "cancelled" | "completed" | "no_show";

export type BookingRow = {
  id: string; account_id: string; calendar_id: string; contact_id: string;
  starts_at: string; ends_at: string; status: BookingStatus;
  note: string | null; cancel_token: string; booker_timezone: string | null;
  reminder_sent_at: string | null;
  meeting_url: string | null; followup_sent_at: string | null;
  review_requested_at: string | null;
  /** 0026 clocks: stamped on the flip TO completed / no_show, never cleared. */
  completed_at: string | null;
  no_show_at: string | null;
  /** 0026 dedupe stamps (send-then-stamp) and SMS attempt markers. */
  no_show_nudged_at: string | null;
  sms_reminder_sent_at: string | null;
  review_request_sms_failed_at: string | null;
  no_show_nudge_sms_failed_at: string | null;
  sms_reminder_failed_at: string | null;
  /** 0047: the customer's own answer to the confirmation text, and when.
   *  Written by the inbound SMS webhook; it never changes `status`. */
  confirm_reply: "yes" | "no" | null;
  confirm_reply_at: string | null;
};

export type CalendarSettingsPatch = Partial<{
  enabled: boolean;
  slotDurationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  openHours: Record<string, [string, string][]>;
  notifyEmails: string[];
  meetingType: "in_person" | "phone" | "video";
  followupEnabled: boolean;
  followupBody: string;
}>;

export type CreateBookingInput = {
  calendarId: string; contactId: string; startsAt: Date; endsAt: Date;
  note?: string; bookerTimezone?: string; ipHash?: string; meetingUrl?: string;
};

export type DueReminder = {
  bookingId: string; accountId: string; contactId: string; startsAt: string;
  bookerTimezone: string | null; cancelToken: string; calendarPublicId: string;
  contactEmail: string | null; contactName: string;
  accountTimezone: string;
  branding: Branding;
  // Reminders are customer-facing outbound, so they carry the account's
  // sending address per the M4d decision -- the same shape the booking
  // confirmation already sends. The lead-alert exclusion (no fromAddress)
  // applies to STAFF-facing mail only; a booker is not the client's staff.
  fromEmail: string | null;
  /** Same discipline as `CreateBookingInput.meetingUrl`: whatever room was
   *  minted at booking time (or null for in_person/phone, or a video booking
   *  whose provider failed) -- the reminder route passes this straight into
   *  `bookingReminderEmail`, never re-derives it. */
  meetingUrl: string | null;
};

export type DueFollowup = {
  bookingId: string; accountId: string; contactId: string; startsAt: string;
  /** The meeting's `ends_at`. Previously the query FILTERED on this column
   *  without selecting it; the send-time gate in the cron route
   *  (`shouldSendFollowupNow`) needs the actual instant, because "the next
   *  morning after the meeting" is measured from when it ENDED, not started. */
  endsAt: string;
  contactEmail: string | null; contactName: string;
  accountTimezone: string;
  branding: Branding;
  fromEmail: string | null; replyToEmail: string | null;
  followupBody: string;
};

const CALENDAR_COLS =
  "id, account_id, public_id, enabled, slot_duration_minutes, buffer_minutes, " +
  "min_notice_hours, max_advance_days, open_hours, notify_emails, " +
  "meeting_type, followup_enabled, followup_body";

const BOOKING_COLS =
  "id, account_id, calendar_id, contact_id, starts_at, ends_at, status, note, " +
  "cancel_token, booker_timezone, reminder_sent_at, meeting_url, followup_sent_at, review_requested_at, " +
  "completed_at, no_show_at, no_show_nudged_at, sms_reminder_sent_at, " +
  "review_request_sms_failed_at, no_show_nudge_sms_failed_at, sms_reminder_failed_at, " +
  "confirm_reply, confirm_reply_at";

// Same shape as newPublicId in forms.ts, but twice the length (24 bytes, not
// 12): this token rides an email link with no rate limit protecting it, so it
// needs to resist guessing, not just collisions.
export function newCancelToken(): string {
  const bytes = randomBytes(24);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Lazy row: the calendar comes into existence the first time anything asks
 * for it (settings page load, public route), not at account creation. Mirrors
 * `ensureConversation`'s race handling exactly — `calendars_one_per_account`
 * is the unique constraint two concurrent lookups can both miss and then both
 * try to insert past.
 */
export async function getOrCreateCalendar(
  db: SupabaseClient, accountId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<CalendarRow> {
  const { data: existing, error: findErr } = await db.from("calendars")
    .select(CALENDAR_COLS).eq("account_id", accountId).maybeSingle();
  if (findErr) throw new Error(`getOrCreateCalendar lookup failed: ${findErr.message}`);
  if (existing) return existing as unknown as CalendarRow;

  const { data, error } = await db.from("calendars")
    .insert({ account_id: accountId, public_id: newPublicId() })
    .select(CALENDAR_COLS).single();

  if (!error) {
    if (!data) throw new Error("getOrCreateCalendar failed: insert returned no row");
    const row = data as unknown as CalendarRow;
    await emit(db, accountId, "calendar.created", actorId, { calendarId: row.id }, actorType);
    return row;
  }

  if (error.code !== "23505") throw new Error(`getOrCreateCalendar failed: ${error.message}`);

  // Lost the race: another caller's insert won between our lookup and our
  // insert. Re-select rather than emit — this call did not create anything.
  const { data: winner, error: reselectErr } = await db.from("calendars")
    .select(CALENDAR_COLS).eq("account_id", accountId).single();
  if (reselectErr || !winner) {
    throw new Error(`calendar re-select after conflict failed: ${reselectErr?.message}`);
  }
  return winner as unknown as CalendarRow;
}

/** Read-only sibling of getOrCreateCalendar for render paths — the setup
 *  page must never CREATE a calendar as a side effect of looking at it. */
export async function getCalendarForAccount(
  db: SupabaseClient, accountId: string,
): Promise<CalendarRow | null> {
  const { data, error } = await db.from("calendars")
    .select(CALENDAR_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getCalendarForAccount failed: ${error.message}`);
  return (data as CalendarRow | null) ?? null;
}

/**
 * Public path. Enabled OR not — the caller (the public page, the embed)
 * checks `enabled` and 404s on false, exactly the way `getPublishedFormByPublicId`
 * leaves `status` for its caller rather than filtering here.
 */
export async function getCalendarByPublicId(
  db: SupabaseClient, publicId: string,
): Promise<CalendarRow | null> {
  const { data, error } = await db.from("calendars").select(CALENDAR_COLS)
    .eq("public_id", publicId).maybeSingle();
  if (error) throw new Error(`getCalendarByPublicId failed: ${error.message}`);
  return (data as unknown as CalendarRow | null) ?? null;
}

export async function updateCalendarSettings(
  db: SupabaseClient, accountId: string, patch: CalendarSettingsPatch, actorId: string,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.slotDurationMinutes !== undefined) row.slot_duration_minutes = patch.slotDurationMinutes;
  if (patch.bufferMinutes !== undefined) row.buffer_minutes = patch.bufferMinutes;
  if (patch.minNoticeHours !== undefined) row.min_notice_hours = patch.minNoticeHours;
  if (patch.maxAdvanceDays !== undefined) row.max_advance_days = patch.maxAdvanceDays;
  if (patch.openHours !== undefined) row.open_hours = patch.openHours;
  if (patch.notifyEmails !== undefined) row.notify_emails = patch.notifyEmails;
  if (patch.meetingType !== undefined) row.meeting_type = patch.meetingType;
  if (patch.followupEnabled !== undefined) row.followup_enabled = patch.followupEnabled;
  if (patch.followupBody !== undefined) row.followup_body = patch.followupBody;
  if (Object.keys(row).length === 0) return;
  row.updated_at = new Date().toISOString();

  // `.select("id")` so the update reports WHICH rows it touched. PostgREST
  // returns no error and no rows for an update matching nothing — without
  // this guard a settings save against a deleted/foreign account would report
  // success while changing nothing (the setBranding lesson).
  const { data, error } = await db.from("calendars")
    .update(row).eq("account_id", accountId).select("id");
  if (error) throw new Error(`updateCalendarSettings failed: ${error.message}`);
  if (!data?.length) throw new Error(`updateCalendarSettings: no calendar for ${accountId}`);
  await emit(db, accountId, "calendar.updated", actorId, { fields: Object.keys(patch) });
}

/**
 * Booked ranges overlapping `[fromIso, toIso)`, for the slot engine to punch
 * out of open hours. Only `status='booked'` binds — the same predicate the
 * exclusion constraint itself uses, so a cancelled booking's old range never
 * blocks a new one here either.
 */
export async function listBookedRanges(
  db: SupabaseClient, calendarId: string, fromIso: string, toIso: string,
): Promise<{ starts_at: string; ends_at: string }[]> {
  const { data, error } = await db.from("bookings")
    .select("starts_at, ends_at")
    .eq("calendar_id", calendarId).eq("status", "booked")
    .lt("starts_at", toIso).gt("ends_at", fromIso)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listBookedRanges failed: ${error.message}`);
  return data ?? [];
}

export class SlotTakenError extends Error {
  constructor(message = "slot already booked") {
    super(message);
    this.name = "SlotTakenError";
  }
}

/**
 * The app re-checks availability before calling this (UX: a friendly "just
 * taken" message with fresh slots), but `bookings_no_overlap` is the actual
 * guarantee — two racers past the app check still resolve here, in the
 * database, and the loser's insert error is mapped to `SlotTakenError` rather
 * than surfacing a raw constraint name to a caller.
 */
export async function createBooking(
  db: SupabaseClient, accountId: string, input: CreateBookingInput, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string; cancelToken: string }> {
  const cancelToken = newCancelToken();
  const { data, error } = await db.from("bookings")
    .insert({
      account_id: accountId,
      calendar_id: input.calendarId,
      contact_id: input.contactId,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      note: input.note ?? null,
      cancel_token: cancelToken,
      booker_timezone: input.bookerTimezone ?? null,
      ip_hash: input.ipHash ?? null,
      meeting_url: input.meetingUrl ?? null,
    })
    .select("id").single();

  if (error || !data) {
    // Postgres SQLSTATE for an exclusion violation is 23P01. PostgREST
    // usually surfaces it as `error.code`, but some proxies drop it, so the
    // constraint name in `error.message` is checked too.
    if (error?.code === "23P01" || error?.message?.includes("bookings_no_overlap")) {
      throw new SlotTakenError();
    }
    throw new Error(`createBooking failed: ${error?.message}`);
  }

  await emit(db, accountId, "booking.created", actorId,
    { bookingId: data.id, calendarId: input.calendarId, contactId: input.contactId }, actorType);
  return { id: data.id, cancelToken };
}

/**
 * Public path: the token IS the authorisation to cancel, exactly as a form's
 * public_id is the authorisation to submit — no accountId, no auth, on
 * purpose. `.eq("status", "booked")` does double duty: it is the guard that
 * only a live booking can be cancelled, AND it is what makes a replayed
 * cancel (the email link clicked twice) return zero rows — a null no-op —
 * instead of a second cancellation event.
 */
export async function cancelBookingByToken(
  db: SupabaseClient, cancelToken: string, actorType: ActorType = "system",
): Promise<BookingRow | null> {
  const { data, error } = await db.from("bookings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("cancel_token", cancelToken).eq("status", "booked")
    .select(BOOKING_COLS);
  if (error) throw new Error(`cancelBookingByToken failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  const row = data[0] as unknown as BookingRow;
  await emit(db, row.account_id, "booking.cancelled", "public", { bookingId: row.id }, actorType);
  return row;
}

/** Operator transitions: cancel, mark completed, mark no-show. */
export async function setBookingStatus(
  db: SupabaseClient, accountId: string, bookingId: string, status: BookingStatus, actorId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  // THE AUTOMATION CLOCKS (0026; spec, "Decisions taken after Milestone A
  // shipped"). The review request runs from the LATER of ends_at and this
  // stamp, so a week of jobs marked completed on Friday earns its review
  // requests on Saturday morning instead of aging out unsent; the no-show
  // nudge runs from no_show_at the same way. Stamped on the flip TO the
  // state, never cleared on a flip away — the status filter already stops a
  // re-opened row from matching — and a re-flip re-stamps.
  const stamp = status === "completed" ? { completed_at: nowIso }
    : status === "no_show" ? { no_show_at: nowIso }
    : {};
  const { data, error } = await db.from("bookings")
    .update({ status, updated_at: nowIso, ...stamp })
    .eq("account_id", accountId).eq("id", bookingId)
    .select("id");
  if (error) throw new Error(`setBookingStatus failed: ${error.message}`);
  if (!data?.length) throw new Error(`setBookingStatus: no booking ${bookingId} for account ${accountId}`);
  await emit(db, accountId, "booking.status_changed", actorId, { bookingId, status });
}

/**
 * The operator's list, `fromIso` forward — no status filter, deliberately:
 * the operator page shows status per row (booked/cancelled/completed/no_show)
 * with actions to change it, so a cancelled booking still needs to be visible
 * as "cancelled", not silently dropped from the list.
 */
export async function listUpcomingBookings(
  db: SupabaseClient, accountId: string, fromIso: string,
): Promise<(BookingRow & { contact_name: string; contact_email: string | null })[]> {
  const { data, error } = await db.from("bookings")
    .select(`${BOOKING_COLS}, contacts(first_name, last_name, email)`)
    .eq("account_id", accountId).gte("starts_at", fromIso)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listUpcomingBookings failed: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => {
    const { contacts, ...rest } = r;
    const contactName = [contacts?.first_name, contacts?.last_name]
      .filter(Boolean).join(" ").trim();
    return {
      ...(rest as BookingRow),
      contact_name: contactName || "Unknown",
      contact_email: contacts?.email ?? null,
    };
  });
}

/**
 * Raw `created_at` instants in `[fromIso, toIso)` for the dashboard's 14-day
 * bookings chart — bucketing happens in JS on the caller side, not here.
 * Deliberately no status filter, unlike `listBookedRanges`: "pipeline
 * added"-style capture is the CREATED count, so a later cancel must not
 * erase a bar this account already earned.
 */
export async function listBookingCreationsBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<string[]> {
  const { data, error } = await db.from("bookings")
    .select("created_at")
    .eq("account_id", accountId).gte("created_at", fromIso).lt("created_at", toIso)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listBookingCreationsBetween failed: ${error.message}`);
  return (data ?? []).map((r: { created_at: string }) => r.created_at);
}

/** Rate limiting for the public booking submit: same shape as forms' countRecentSubmissions. */
export async function countRecentBookings(
  db: SupabaseClient, calendarId: string, ipHash: string, windowStartIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("calendar_id", calendarId).eq("ip_hash", ipHash).gte("created_at", windowStartIso);
  if (error) throw new Error(`countRecentBookings failed: ${error.message}`);
  return count ?? 0;
}

// No `name`: `accounts.name` is the agency's internal label ("Rio Roofing —
// trial"), the due-rows built from this read have no field for it, and
// `brandDisplayName` no longer takes it. Not selected at all, so there is
// nothing here for a future mapper to reach for.
export const ACCOUNT_BRAND_COLS =
  "timezone, brand_name, brand_logo_path, brand_color, brand_neutral, " +
  "brand_corners, brand_type, brand_mode, reply_to_email, from_email, outbound_suppressed, " +
  // 0048. Appended, not slotted in: one more column in a read every due-list
  // already makes, rather than a second read for the one recipe that prints it.
  "mailing_address";

/**
 * The cron windows, exported so they can be asserted against the schedule in
 * `apps/web/vercel.json` (cron-coupling.test.ts) instead of only described in
 * comments. The three are COUPLED — see the route's doc comment. The
 * follow-up window MUST equal `FOLLOWUP_MAX_AGE_MS` in
 * `apps/web/src/lib/booking/followup-timing.ts`; the same test pins that.
 */
export const REMINDER_WINDOW_START_MS = 23 * 60 * 60 * 1000;
export const REMINDER_WINDOW_END_MS = (24 * 60 + 15) * 60 * 1000;
export const FOLLOWUP_QUERY_WINDOW_MS = 37 * 60 * 60 * 1000;

export type AccountBrandInfo = {
  accountTimezone: string; branding: Branding;
  fromEmail: string | null; replyToEmail: string | null;
  /** Migration 0032. True = every pass skips this account's due work. */
  outboundSuppressed: boolean;
  /** Migration 0048. The postal address the reactivation email prints; null
   *  = not set. Carried as stored, untrimmed: the pass judges blankness. */
  mailingAddress: string | null;
};

/**
 * One `accounts` read per distinct account id — the per-tick cache the due
 * lists share. Throws on a missing account: a due row whose account cannot
 * be read is a data problem, not a row to skip silently. Not batched into a
 * single `.in()`: this runs on a 15-minute cron, and one account is the real
 * shape today.
 */
export async function loadAccountBrandInfo(
  db: SupabaseClient, accountIds: readonly string[], caller: string,
): Promise<Map<string, AccountBrandInfo>> {
  const out = new Map<string, AccountBrandInfo>();
  for (const accountId of accountIds) {
    const { data, error } = await db.from("accounts")
      .select(ACCOUNT_BRAND_COLS).eq("id", accountId).single();
    if (error || !data) {
      throw new Error(`${caller}: account lookup failed for ${accountId}: ${error?.message}`);
    }
    const acct = data as unknown as {
      timezone: string;
      brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
      brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"];
      brand_type: Branding["brandType"]; brand_mode: Branding["brandMode"];
      reply_to_email: string | null; from_email: string | null;
      outbound_suppressed: boolean;
      mailing_address: string | null;
    };
    out.set(accountId, {
      accountTimezone: acct.timezone,
      branding: {
        brandName: acct.brand_name ?? null,
        brandLogoPath: acct.brand_logo_path ?? null,
        brandColor: acct.brand_color ?? null,
        brandNeutral: acct.brand_neutral ?? null,
        brandCorners: acct.brand_corners ?? null,
        brandType: acct.brand_type ?? null,
        brandMode: acct.brand_mode ?? null,
        replyToEmail: acct.reply_to_email ?? null,
      },
      outboundSuppressed: acct.outbound_suppressed === true,
      fromEmail: acct.from_email ?? null,
      replyToEmail: acct.reply_to_email ?? null,
      mailingAddress: acct.mailing_address ?? null,
    });
  }
  return out;
}

/**
 * `nowIso` is caller-injected (the cron route passes real now; tests pin a
 * fixed instant) — never computed from `Date.now()` inside here, or the test
 * suite could not assert the window's edges deterministically.
 *
 * The window is `[now+23h, now+24h15m]` — 75 minutes wide, sized to the
 * every-15-minutes cron restored when the account moved to Vercel Pro on
 * 2026-09-05 (see the `crons` entry in `apps/web/vercel.json` — the literal
 * cron string is not quoted here on purpose, since its leading star-slash
 * would close this comment). Between 2026-08-23
 * and that upgrade this was `[now, now+25h]`, because the Hobby plan
 * rejects any deployment carrying a sub-daily schedule and a once-a-day
 * tick has to cover the whole day ahead in one pass. That fallback bought
 * coverage at the cost of accuracy: a booking two hours away and a booking
 * a day away were both "due" on the same tick, so bookers got reminders up
 * to a day early. Back on the 15-minute cadence, the first tick that sees a
 * booking is the one ~24h15m before it starts, so the reminder lands ~24h
 * out, which is what the email itself claims.
 *
 * Why 75 minutes rather than one tick's worth: a booking starting at S is
 * returned by every tick in `[S-24h15m, S-23h]`, so five or six consecutive
 * ticks see it and `reminder_sent_at` dedupes all but the first. The extra
 * 60 minutes beyond the 15-minute cadence is deliberate tick-timing
 * tolerance — Hobby ticks were measured drifting by as much as 54 minutes,
 * and Pro is not promised to be exact either.
 *
 * That tolerance is bounded, not unlimited, and the bound moved with the
 * window: an outage (cron paused, the route 503ing, a deploy freeze) that
 * leaves a gap of more than 75 minutes between successful ticks can step
 * clean over a booking's entire eligible span, and nothing later notices or
 * catches it up. Under the 25h window that bound was one hour of the day's
 * single tick slipping; it is now 75 minutes between any two ticks — a
 * different shape of the same risk, and strictly more forgiving in practice
 * because there are 96 chances a day instead of one. Accepted; revisit if
 * outages that long turn out to happen.
 *
 * HOW MUCH SLACK THAT ACTUALLY LEAVES, stated plainly because the number is
 * uncomfortable and the failure is silent. This repo has a MEASURED cron
 * jitter figure: 54 minutes, from the Hobby daily tick (2026-08-24). A tick
 * that is on time followed by one that is 54 minutes late is a 69-minute gap,
 * against a 75-minute window — about SIX MINUTES of slack. Anything wider
 * than 75 minutes and the booking is stepped over: no reminder, ever, and no
 * error, no retry and no counter anywhere records it. The `sent` count simply
 * never mentions that booking.
 *
 * Two things keep that from being an emergency rather than a risk. The 54
 * minutes was measured on HOBBY, where a daily job is scheduled loosely on
 * purpose; Pro's every-15-minutes scheduling is expected to be far tighter.
 * And it is UNMEASURED on Pro — expected is not observed, and nothing here
 * has watched a real Pro tick yet. Worth measuring: log tick arrival times
 * and check the spread before trusting the 6 minutes.
 *
 * DO NOT "fix" this by widening the window. That is the tempting move and it
 * is wrong: the width is also what decides how early a reminder goes out, and
 * widening it walks straight back into the bug this branch just fixed (under
 * the 25h window a booking two hours away and one a day away were both due on
 * the same tick, so bookers got reminders up to a day early). If Pro's jitter
 * turns out to be worse than 75 minutes, the answer is a catch-up pass that
 * can tell "missed" from "not yet" — not a wider window that mistimes every
 * reminder to cover a rare one.
 */
/**
 * The due-lists' shared preamble: load each row's account, then drop the rows
 * belonging to a suppressed account (migration 0032).
 *
 * Every `listDue*` goes through here rather than filtering for itself, so the
 * rule is written once. A new pass that forgets is caught by
 * `outbound-suppressed.test.ts`, which walks this file and automations.ts and
 * fails on a `listDue*` still calling `loadAccountBrandInfo` directly.
 *
 * The account read is unchanged and still throws on a missing account: a due
 * row whose account cannot be read is a data problem, not a row to skip.
 */
export async function loadSendableRows<T extends { account_id: string }>(
  db: SupabaseClient, rows: readonly T[], caller: string,
): Promise<{ sendable: T[]; accountInfo: Map<string, AccountBrandInfo> }> {
  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id))], caller);
  return {
    sendable: rows.filter((r) => !accountInfo.get(r.account_id)!.outboundSuppressed),
    accountInfo,
  };
}

/** A subject looked up by id for RELEASE: the row, or why there is none —
 *  `gone` (cancelled, already sent, deleted) or `off` (the recipe, the
 *  calendar's feature, or the account's outbound is switched off). */
export type DueLookup<T> = { due: T; why?: undefined } | { due: null; why: "gone" | "off" };

const REMINDER_SELECT = `id, account_id, contact_id, starts_at, booker_timezone, cancel_token, meeting_url,
             calendars(public_id), contacts(first_name, last_name, email)`;

function toDueReminder(r: any, info: AccountBrandInfo): DueReminder {
  const contactName = [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(" ").trim();
  return {
    bookingId: r.id, accountId: r.account_id, contactId: r.contact_id, startsAt: r.starts_at,
    bookerTimezone: r.booker_timezone ?? null, cancelToken: r.cancel_token,
    calendarPublicId: r.calendars?.public_id, contactEmail: r.contacts?.email ?? null,
    contactName: contactName || "Unknown", accountTimezone: info.accountTimezone,
    branding: info.branding, fromEmail: info.fromEmail, meetingUrl: r.meeting_url ?? null,
  };
}

export async function listDueReminders(
  db: SupabaseClient, nowIso: string,
): Promise<DueReminder[]> {
  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + REMINDER_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + REMINDER_WINDOW_END_MS).toISOString();

  const { data, error } = await db.from("bookings")
    .select(REMINDER_SELECT)
    .eq("status", "booked").is("reminder_sent_at", null)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueReminders failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // One `accounts` read per distinct account (in practice always one) for
  // the name/timezone and branding — shared with the other due-lists.
  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueReminders");

  return sendable.map((r: any) => toDueReminder(r, accountInfo.get(r.account_id as string)!));
}

/** The same predicates as the due-list MINUS the time window: the release
 *  step decides "when", this answers "is it still a reminder to send". */
export async function getDueReminderById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueReminder>> {
  const { data, error } = await db.from("bookings").select(REMINDER_SELECT)
    .eq("id", bookingId).eq("status", "booked").is("reminder_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueReminderById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueReminderById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueReminder(data, accountInfo.get((data as any).account_id)!) };
}

/**
 * Send-then-stamp — deliberately the REVERSE of messaging's write-then-send.
 * There the row records an attempt and must exist before anything leaves the
 * building; here `reminder_sent_at` is a dedupe marker, and stamping before a
 * send that then fails would silence the reminder forever. Callers stamp
 * only after a confirmed send.
 */
export async function stampReminderSent(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReminderSent failed: ${error.message}`);
}

/**
 * Follow-ups look BACKWARD from `now` on `ends_at` -- the mirror image of
 * `listDueReminders`' forward window on `starts_at`. `calendars!inner(...)` +
 * `.eq("calendars.followup_enabled", true)` is what makes a calendar with
 * follow-ups turned off never surface here, mirroring how reminders don't
 * filter on the calendar at all (a booking calendar's own `enabled` flag is a
 * different knob -- the public page's on/off switch, not the follow-up
 * feature's).
 *
 * THIS WINDOW IS NOT THE SEND DECISION. It is a candidate list. Unlike the
 * reminder window, which is tight enough to be the whole rule, everything
 * returned here is then put through `shouldSendFollowupNow`
 * (`apps/web/src/lib/booking/followup-timing.ts`), which decides whether NOW
 * is the right MOMENT: the next morning, 08:00-11:00, in the account's own
 * timezone, on a strictly later local calendar day than the meeting ended on.
 * Until 2026-09-05 there was no such gate -- the cron ticked once a day at
 * 14:00 UTC, early morning in the Rio Grande Valley, and "next morning" fell
 * out of the tick hour by accident. At 96 ticks a day it has to be explicit.
 *
 * The 37h window is sized so that gate can always fire, and it is derived
 * rather than round (the full arithmetic lives on FOLLOWUP_MAX_AGE_MS in
 * followup-timing.ts, which MUST hold the same number):
 *
 *   32h  a meeting ending at 00:00:00 local waits out the rest of that local
 *        day (24h) plus the small hours of the next (8h) before the morning
 *        band can open -- the worst case.
 *   + 3h  the band stays open until 11:00 local, and sizing to its CLOSE
 *        rather than its open is what lets ANY tick inside the band send,
 *        instead of only the first one.
 *   + 2h  the largest scheduled backward clock shift in the IANA database
 *        (Antarctica/Troll, UTC+2 -> UTC+0), which stretches that local day
 *        to 26 real hours.
 *
 * It is also the explicit staleness cap, which the old 25h window got for
 * free and a naive widening would have thrown away: nothing older than 37h is
 * ever a candidate, so an outage of days cannot come back up and mail someone
 * about a meeting they have forgotten. The cost is a bounded catch-up -- a
 * meeting whose whole next-morning band was missed may still go out the
 * morning after that, if it lands inside 37h. Two mornings late is
 * recoverable; a week is not.
 *
 * `followup_sent_at` still does all the deduping, unchanged: the gate has no
 * memory, so without that column the ~12 ticks inside one morning band would
 * each send.
 */
const FOLLOWUP_SELECT = `id, account_id, contact_id, starts_at, ends_at, calendars!inner(followup_body, followup_enabled), contacts(first_name, last_name, email)`;

function toDueFollowup(r: any, info: AccountBrandInfo): DueFollowup {
  const contactName = [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(" ").trim();
  return {
    bookingId: r.id, accountId: r.account_id, contactId: r.contact_id, startsAt: r.starts_at, endsAt: r.ends_at,
    contactEmail: r.contacts?.email ?? null, contactName: contactName || "Unknown",
    accountTimezone: info.accountTimezone, branding: info.branding,
    fromEmail: info.fromEmail, replyToEmail: info.replyToEmail, followupBody: r.calendars?.followup_body ?? "",
  };
}

export async function listDueFollowups(
  db: SupabaseClient, nowIso: string,
): Promise<DueFollowup[]> {
  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - FOLLOWUP_QUERY_WINDOW_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select(FOLLOWUP_SELECT)
    // Widened past "booked": an operator's "Mark completed" on the list
    // must not silence the follow-up this feature exists to send.
    // no_show stays excluded -- deliberately deferred, not an oversight.
    .in("status", ["booked", "completed"]).is("followup_sent_at", null)
    .eq("calendars.followup_enabled", true)
    .gte("ends_at", windowStart).lte("ends_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueFollowups failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // Same per-account cache as listDueReminders. DueFollowup carries
  // replyToEmail top-level (not just nested in branding) so the follow-up
  // sender can set a Reply-To without digging into branding the way the
  // reminder path does.
  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueFollowups");

  return sendable.map((r: any) => toDueFollowup(r, accountInfo.get(r.account_id as string)!));
}

export async function getDueFollowupById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueFollowup>> {
  const { data, error } = await db.from("bookings").select(FOLLOWUP_SELECT)
    .eq("id", bookingId).in("status", ["booked", "completed"]).is("followup_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueFollowupById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  if ((data as any).calendars?.followup_enabled !== true) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueFollowupById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueFollowup(data, accountInfo.get((data as any).account_id)!) };
}

/** Send-then-stamp, same reasoning as stampReminderSent: stamp only after a confirmed send. */
export async function stampFollowupSent(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ followup_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampFollowupSent failed: ${error.message}`);
}
