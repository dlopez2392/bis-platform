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
};

export type BookingStatus = "booked" | "cancelled" | "completed" | "no_show";

export type BookingRow = {
  id: string; account_id: string; calendar_id: string; contact_id: string;
  starts_at: string; ends_at: string; status: BookingStatus;
  note: string | null; cancel_token: string; booker_timezone: string | null;
  reminder_sent_at: string | null;
};

export type CalendarSettingsPatch = Partial<{
  enabled: boolean;
  slotDurationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  openHours: Record<string, [string, string][]>;
  notifyEmails: string[];
}>;

export type CreateBookingInput = {
  calendarId: string; contactId: string; startsAt: Date; endsAt: Date;
  note?: string; bookerTimezone?: string; ipHash?: string;
};

export type DueReminder = {
  bookingId: string; accountId: string; startsAt: string;
  bookerTimezone: string | null; cancelToken: string; calendarPublicId: string;
  contactEmail: string | null; contactName: string;
  accountName: string; accountTimezone: string;
  branding: Branding;
  // Reminders are customer-facing outbound, so they carry the account's
  // sending address per the M4d decision -- the same shape the booking
  // confirmation already sends. The lead-alert exclusion (no fromAddress)
  // applies to STAFF-facing mail only; a booker is not the client's staff.
  fromEmail: string | null;
};

const CALENDAR_COLS =
  "id, account_id, public_id, enabled, slot_duration_minutes, buffer_minutes, " +
  "min_notice_hours, max_advance_days, open_hours, notify_emails";

const BOOKING_COLS =
  "id, account_id, calendar_id, contact_id, starts_at, ends_at, status, note, " +
  "cancel_token, booker_timezone, reminder_sent_at";

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
  const { data, error } = await db.from("bookings")
    .update({ status, updated_at: new Date().toISOString() })
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

const ACCOUNT_BRAND_COLS =
  "name, timezone, brand_name, brand_logo_path, brand_color, brand_neutral, " +
  "brand_corners, brand_type, brand_mode, reply_to_email, from_email";

/**
 * `nowIso` is caller-injected (the cron route passes real now; tests pin a
 * fixed instant) — never computed from `Date.now()` inside here, or the test
 * suite could not assert the window's edges deterministically.
 *
 * The window is `[now+23h, now+24h15m]`, keyed to lead time rather than an
 * equality check, so a missed cron tick is caught by the next one instead of
 * losing the reminder outright.
 *
 * That tolerance is bounded, not unlimited: an outage (cron paused, the
 * route 503ing, etc.) longer than the 75-minute window permanently misses
 * any booking whose window closed while it was down — there is no recovery
 * pass that later notices and catches it up. Accepted for v1; revisit if
 * outages of that length turn out to happen in practice.
 */
export async function listDueReminders(
  db: SupabaseClient, nowIso: string,
): Promise<DueReminder[]> {
  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + 23 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + (24 * 60 + 15) * 60 * 1000).toISOString();

  const { data, error } = await db.from("bookings")
    .select(`id, account_id, starts_at, booker_timezone, cancel_token,
             calendars(public_id), contacts(first_name, last_name, email)`)
    .eq("status", "booked").is("reminder_sent_at", null)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueReminders failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // One extra query per distinct account (in practice always one) for the
  // account name/timezone and branding — all of which live on `accounts`.
  // Not prematurely batched into a single `.in()` join: this route runs on a
  // 15-minute cron, not a hot path, and one account is the real shape today.
  const accountIds = [...new Set(rows.map((r) => r.account_id as string))];
  const accountInfo = new Map<
    string,
    { accountName: string; accountTimezone: string; branding: Branding; fromEmail: string | null }
  >();
  for (const accountId of accountIds) {
    const { data: acctData, error: acctErr } = await db.from("accounts")
      .select(ACCOUNT_BRAND_COLS).eq("id", accountId).single();
    if (acctErr || !acctData) {
      throw new Error(`listDueReminders: account lookup failed for ${accountId}: ${acctErr?.message}`);
    }
    const acct = acctData as unknown as {
      name: string; timezone: string;
      brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
      brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"];
      brand_type: Branding["brandType"]; brand_mode: Branding["brandMode"];
      reply_to_email: string | null; from_email: string | null;
    };
    accountInfo.set(accountId, {
      accountName: acct.name,
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
      fromEmail: acct.from_email ?? null,
    });
  }

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const contactName = [r.contacts?.first_name, r.contacts?.last_name]
      .filter(Boolean).join(" ").trim();
    return {
      bookingId: r.id,
      accountId: r.account_id,
      startsAt: r.starts_at,
      bookerTimezone: r.booker_timezone ?? null,
      cancelToken: r.cancel_token,
      calendarPublicId: r.calendars?.public_id,
      contactEmail: r.contacts?.email ?? null,
      contactName: contactName || "Unknown",
      accountName: info.accountName,
      accountTimezone: info.accountTimezone,
      branding: info.branding,
      fromEmail: info.fromEmail,
    };
  });
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
