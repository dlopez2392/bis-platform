import { randomBytes, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { newPublicId, ALPHABET } from "./forms";
import type { Branding } from "./branding";
import { bookingAuthor, type AuthorKind, type RowAuthor } from "./provenance";
import { withTimelinePage, forContacts, type TimelinePageOpts } from "./timeline-cursor";
import { recipientLanguage, type RecipientLanguage } from "./messaging";

export type CalendarRow = {
  id: string; account_id: string; public_id: string; enabled: boolean;
  slot_duration_minutes: number; buffer_minutes: number;
  min_notice_hours: number; max_advance_days: number;
  open_hours: Record<string, [string, string][]>;
  notify_emails: string[];
  meeting_type: "in_person" | "phone" | "video";
  followup_enabled: boolean; followup_body: string;
  /** S-09 PR 2 (0076): NULL = our Spanish default, '' = emptied (the English), else theirs. */
  followup_body_es: string | null;
  /** The English `followup_body` the Spanish box was last saved beside (C14's staleness compare). */
  followup_body_es_basis: string | null;
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
  /** F-046 (0107): this booking's own kind; NULL = the calendar's `meeting_type`. Optional: no read selects it yet. */
  meeting_type?: BookingMeetingType | null;
};

/** F-046 (0107): how a booking meets. A booking's own NULL means its calendar's. */
export type BookingMeetingType = "in_person" | "phone" | "video";
/** F-046 (0107): the email a staff job's hold sends when it settles. */
export type NoticeWanted = "confirmation" | "moved";

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
  followupBodyEs: string | null;
  followupBodyEsBasis: string | null;
}>;

export type CreateBookingInput = {
  calendarId: string; contactId: string; startsAt: Date; endsAt: Date;
  note?: string; bookerTimezone?: string; ipHash?: string; meetingUrl?: string;
  /** D-035 (0061): the booking this one replaces, when it is made by
   *  rescheduling. The caller still cancels the old row itself. A linked row
   *  is left out of `listBookingCreationsBetween`, so a reschedule is not
   *  counted as a new booking. Must be one of the SAME account's bookings
   *  (composite FK `bookings_rescheduled_from_fkey`); another account's id
   *  throws, naming that constraint. */
  rescheduledFromId?: string;
};

export type DueReminder = {
  bookingId: string; accountId: string; contactId: string; startsAt: string;
  /** 0097 (S-47d, SD20): when the appointment was kept through a closure; null when nobody kept it. Read from
   *  this row, by-id re-reads included, so a release sees a fresh Keep however old the appointment is. */
  closureKeptAt: string | null;
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
  /** D-029: booked less than the day-before window's span ahead
   *  (`isLateBooking`). The reminders pass gives such a reminder an earlier
   *  deadline (`reminderDeadline` in apps/web) so a held one cannot be
   *  released beside the text reminder. Set on every row, by-id reads too. */
  late: boolean;
  /** S-09 PR 2: the language this reminder is written in — contacts.language, else accounts.language, else
   *  English (recipientLanguage, resolved HERE once, spec C12). Set on every row, by-id reads too. */
  language: RecipientLanguage;
  /** For the late rule's `textCovers` (plan deviation 2): is there a textable phone at all. Unjudged here. */
  contactPhone: string | null;
};

export type DueFollowup = {
  bookingId: string; accountId: string; contactId: string; startsAt: string;
  /** 0097 (S-47d, SD20): when the appointment was kept through a closure; null when nobody kept it. Read from
   *  this row, by-id re-reads included, so a release sees a fresh Keep however old the appointment is. */
  closureKeptAt: string | null;
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
  language: RecipientLanguage;
  /** 0076: NULL = our Spanish default, '' = emptied (the English), else theirs. */
  followupBodyEs: string | null;
};

const CALENDAR_COLS =
  "id, account_id, public_id, enabled, slot_duration_minutes, buffer_minutes, " +
  "min_notice_hours, max_advance_days, open_hours, notify_emails, " +
  "meeting_type, followup_enabled, followup_body, followup_body_es, followup_body_es_basis";

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
  if (patch.followupBodyEs !== undefined) row.followup_body_es = patch.followupBodyEs;
  if (patch.followupBodyEsBasis !== undefined) row.followup_body_es_basis = patch.followupBodyEsBasis;
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
  /** F-048: leave this one booking out — the one a customer is MOVING, which
   *  is still `booked` while they pick (`computeMoveSlots` in apps/web). */
  excludeBookingId?: string,
): Promise<{ id: string; starts_at: string; ends_at: string }[]> {
  // F-046: `id` too, so a staff job's overlap warning can name the jobs it overlaps (plan correction 10).
  let q = db.from("bookings")
    .select("id, starts_at, ends_at")
    .eq("calendar_id", calendarId).eq("status", "booked")
    .lt("starts_at", toIso).gt("ends_at", fromIso);
  if (excludeBookingId !== undefined) q = q.neq("id", excludeBookingId);
  const { data, error } = await q.order("starts_at", { ascending: true });
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
  const { data, error } = await insertBookingRow(db, accountId, input, cancelToken, bookingAuthor(actorType, actorId));
  if (error || !data) {
    // Postgres SQLSTATE for an exclusion violation is 23P01. PostgREST
    // usually surfaces it as `error.code`, but some proxies drop it, so the
    // constraint name in `error.message` is checked too.
    if (isOverlapError(error)) throw new SlotTakenError();
    throw new Error(`createBooking failed: ${error?.message}`);
  }

  await emit(db, accountId, "booking.created", actorId,
    { bookingId: data.id, calendarId: input.calendarId, contactId: input.contactId }, actorType);
  return { id: data.id, cancelToken };
}

type WriteError = { code?: string; message?: string } | null;

function isOverlapError(error: WriteError): boolean {
  return error?.code === "23P01" || error?.message?.includes("bookings_no_overlap") === true;
}

/** F-046 (0107): the columns only a staff job, or a move carrying a row's own place and kind, writes. */
type BookingExtraColumns = Partial<{
  place_id: string | null; meeting_type: BookingMeetingType | null; hold_until: string | null;
  notice_wanted: NoticeWanted | null; closure_kept_at: string | null;
}>;

/** The row `createBooking` writes, and nothing else: no event. Shared with
 *  `moveBooking`, which must tell a write that failed from an event that
 *  failed after the write landed (fix round 1, I2). F-046: `extra` is spread
 *  LAST and is empty by default, so `createBooking`'s insert is unchanged. */
async function insertBookingRow(
  db: SupabaseClient, accountId: string, input: CreateBookingInput, cancelToken: string, author: RowAuthor,
  extra: BookingExtraColumns = {},
): Promise<{ data: { id: string } | null; error: WriteError }> {
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
      rescheduled_from_id: input.rescheduledFromId ?? null,
      // Who made it (0073, spec §5.2): bookingAuthor, from the actor the caller passes.
      author_kind: author.authorKind,
      author_id: author.authorId,
      ...extra,
    })
    .select("id").single();
  return { data: (data as { id: string } | null) ?? null, error: (error as WriteError) ?? null };
}

export type StaffJobInput = {
  calendarId: string; contactId: string; startsAt: Date; endsAt: Date;
  note: string | null; placeId: string | null; meetingType: BookingMeetingType; meetingUrl: string | null;
  holdUntil: Date; noticeWanted: NoticeWanted | null; closureKept: boolean;
};

/**
 * F-046 (spec 6.1): a job a person on the dashboard books. Person-made (R1: it may overlap, 0107), in the
 * account's zone (no booker zone), held for the Undo window (`hold_until`). `closure_kept_at` is stamped
 * only when "You're closed that day" was accepted, or the closure would hold its reminders. NO event:
 * `booking.created` is written when the hold settles (D8), so an undone add leaves no "New booking" behind.
 * One INSERT: it takes the calendar row in 0107's trigger and holds no other row, so it cannot deadlock
 * with an undo (the lock rule). A 23P01 (a customer-made row cannot reach here; kept for parity) is
 * `SlotTakenError`. THROWS on any other write error.
 */
export async function createStaffJob(
  db: SupabaseClient, accountId: string, input: StaffJobInput, actorId: string,
): Promise<{ id: string; cancelToken: string }> {
  const cancelToken = newCancelToken();
  const { data, error } = await insertBookingRow(db, accountId, {
    calendarId: input.calendarId, contactId: input.contactId, startsAt: input.startsAt, endsAt: input.endsAt,
    note: input.note ?? undefined, meetingUrl: input.meetingUrl ?? undefined,
  }, cancelToken, bookingAuthor("user", actorId), {
    place_id: input.placeId, meeting_type: input.meetingType, hold_until: input.holdUntil.toISOString(),
    notice_wanted: input.noticeWanted, closure_kept_at: input.closureKept ? new Date().toISOString() : null,
  });
  if (error || !data) {
    if (isOverlapError(error)) throw new SlotTakenError();
    throw new Error(`createStaffJob failed: ${error?.message}`);
  }
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

/** D-030: an outcome (completed / no_show) asked for an appointment that has
 *  not started by the caller's `startedBy` instant. Nothing was written. */
export class BookingNotStartedError extends Error {
  constructor(message = "booking has not started yet") {
    super(message);
    this.name = "BookingNotStartedError";
  }
}

/**
 * Operator transitions: cancel, mark completed, mark no-show. Also the phone
 * receptionist's cancel/reschedule, which passes `actorType: "ai"` — omitted,
 * it stays `"user"`, so every operator call site keeps its attribution.
 *
 * `opts.startedBy` (D-030): when given, an OUTCOME — completed or no_show —
 * is written only if the booking's `starts_at` is at or before that instant,
 * as a predicate on the UPDATE itself, so there is no read-then-write gap.
 * A refusal throws `BookingNotStartedError` and writes nothing (a no-show on
 * a future job would arm the no-show nudge to the customer). The operator
 * action passes it; omitted (the demo seed, the db tests, the receptionist's
 * cancel) the write is exactly what it was. Cancel is never an outcome and
 * is never refused by it.
 *
 * `opts.onlyFrom` (D-036): the row is written only if its CURRENT status is
 * that one, as a predicate on the UPDATE (zero rows throws "no booking",
 * like the wrong account). The Calendar page's Undo is
 * `"booked", { onlyFrom: "cancelled" }` — an un-cancel, never an un-complete.
 *
 * A flip back to "booked" re-enters `bookings_no_overlap` (Postgres re-checks
 * an exclusion constraint on UPDATE), so a time someone booked in between is
 * `SlotTakenError`, mapped exactly as `createBooking` maps it.
 *
 * F-048: answers the `updated_at` it wrote. Only a status write sets that
 * column, so it is this write's VERSION: `opts.version` writes only a row
 * still carrying the version named (an Undo of exactly that cancel), and
 * `claimCancelNotice` claims exactly that cancel's notice.
 */
export async function setBookingStatus(
  db: SupabaseClient, accountId: string, bookingId: string, status: BookingStatus, actorId: string,
  actorType: ActorType = "user",
  opts: { startedBy?: string; onlyFrom?: BookingStatus; version?: string } = {},
): Promise<{ updatedAt: string }> {
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
  const guarded = opts.startedBy !== undefined && (status === "completed" || status === "no_show");
  let q = db.from("bookings")
    .update({ status, updated_at: nowIso, ...stamp })
    .eq("account_id", accountId).eq("id", bookingId);
  if (guarded) q = q.lte("starts_at", opts.startedBy!);
  if (opts.onlyFrom !== undefined) q = q.eq("status", opts.onlyFrom);
  if (opts.version !== undefined) q = q.eq("updated_at", opts.version);
  const { data, error } = await q.select("id");
  if (error) {
    if (error.code === "23P01" || error.message?.includes("bookings_no_overlap")) throw new SlotTakenError();
    throw new Error(`setBookingStatus failed: ${error.message}`);
  }
  if (!data?.length) {
    // Zero rows under the guard is either "not started" or "no such booking
    // here"; one read tells them apart so the operator is told which.
    if (guarded) {
      const { data: row, error: readErr } = await db.from("bookings").select("id")
        .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
      if (readErr) throw new Error(`setBookingStatus re-read failed: ${readErr.message}`);
      if (row) throw new BookingNotStartedError();
    }
    throw new Error(`setBookingStatus: no booking ${bookingId} for account ${accountId}`);
  }
  await emit(db, accountId, "booking.status_changed", actorId, { bookingId, status }, actorType);
  return { updatedAt: nowIso };
}

/** D-036: an Undo the Calendar page must not perform. Nothing was written.
 *  `rescheduled`: a newer booking replaced this one (its
 *  `rescheduled_from_id` points here), so restoring it would put a second
 *  live appointment beside the replacement. `not_operator_cancel`: the last
 *  cancel was the customer's (their link) or Sofía's (a call), not a person
 *  on the dashboard, so it is the customer's decision to reverse, not ours.
 *  `superseded` (F-048): the row is still cancelled but no longer carries
 *  the version this Undo names: the cancel's customer notice claimed it, or a
 *  later cancel replaced it. Which one, and whether the email actually went,
 *  is the caller's to tell (the notice's thread row says). */
export class BookingNotRestorableError extends Error {
  constructor(readonly reason: "rescheduled" | "not_operator_cancel" | "superseded") {
    super(`booking cannot be restored: ${reason}`);
    this.name = "BookingNotRestorableError";
  }
}

/**
 * The Calendar page's Undo on a Cancel (D-036): back to "booked" only when a
 * person on the dashboard made the cancel and no reschedule has replaced the
 * booking since. Both are reads before the write; the write itself still
 * carries `onlyFrom: "cancelled"` and the overlap constraint, so the
 * remaining gap (a reschedule landing between the read and the write, in an
 * Undo window of seconds) can at worst be refused by the constraint, never
 * reopen a non-cancelled row.
 *
 * "Who cancelled" is the newest cancel event for the row: `booking.cancelled`
 * (the customer's link, actor 'system'/'public') or `booking.status_changed`
 * with status 'cancelled' (the dashboard, actor 'user'; Sofía, actor 'ai').
 * No event at all is refused too: nothing proves a person did it.
 *
 * `version` (F-048, REQUIRED): the cancel's own `updatedAt`. The write lands
 * only while the row still carries it, so it can never follow the cancel's
 * customer notice, which claims the row by moving the version on
 * (`claimCancelNotice`). A write refused that way, on a row still
 * cancelled, is `superseded`. There is no unversioned Undo.
 */
export async function undoOperatorCancel(
  db: SupabaseClient, accountId: string, bookingId: string, actorId: string, version: string,
): Promise<void> {
  const { data: replacement, error: replErr } = await db.from("bookings").select("id")
    .eq("account_id", accountId).eq("rescheduled_from_id", bookingId).limit(1);
  if (replErr) throw new Error(`undoOperatorCancel replacement read failed: ${replErr.message}`);
  if (replacement && replacement.length > 0) throw new BookingNotRestorableError("rescheduled");

  const { data: events, error: evErr } = await db.from("events").select("type, actor_type, payload")
    .eq("account_id", accountId).in("type", ["booking.cancelled", "booking.status_changed"])
    .eq("payload->>bookingId", bookingId)
    // `id` breaks a created_at tie so the same rows always read the same way.
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (evErr) throw new Error(`undoOperatorCancel event read failed: ${evErr.message}`);
  const lastCancel = ((events ?? []) as { type: string; actor_type: string; payload: { status?: string } }[])
    .find((e) => e.type === "booking.cancelled" || e.payload?.status === "cancelled");
  if (!lastCancel || lastCancel.type !== "booking.status_changed" || lastCancel.actor_type !== "user") {
    throw new BookingNotRestorableError("not_operator_cancel");
  }

  try {
    await setBookingStatus(db, accountId, bookingId, "booked", actorId, "user", { onlyFrom: "cancelled", version });
  } catch (e) {
    if (e instanceof SlotTakenError) throw e;
    // Zero rows. Told apart by one read, after the fact: still cancelled
    // under a different version means the notice claimed it first.
    const { data: row, error: readErr } = await db.from("bookings").select("status, updated_at")
      .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
    if (readErr) throw new Error(`undoOperatorCancel re-read failed: ${readErr.message}`);
    const r = row as { status: BookingStatus; updated_at: string } | null;
    if (r && r.status === "cancelled"
      && new Date(r.updated_at).getTime() !== new Date(version).getTime()) {
      throw new BookingNotRestorableError("superseded");
    }
    throw e;
  }
}

/**
 * F-048: the Calendar page's customer notice claims its cancel, once the
 * Undo window has closed and before anything is sent. One conditional
 * UPDATE: the row must still be cancelled and still carry the cancel's
 * version, and the claim moves the version on. The Undo's own write is
 * conditional on that same version (`undoOperatorCancel`'s required `version` argument),
 * so Postgres serialises the two on the row and exactly one of them wins:
 * an Undo that landed first leaves nothing to claim (no notice goes), and
 * a claim that landed first refuses the Undo (`superseded`).
 *
 * `true` = this caller owns the send. A cancel that was undone, undone and
 * cancelled again (a newer version), or never cancelled answers `false`.
 */
export async function claimCancelNotice(
  db: SupabaseClient, accountId: string, bookingId: string, version: string,
): Promise<boolean> {
  const { data, error } = await db.from("bookings")
    .update({ updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", bookingId)
    .eq("status", "cancelled").eq("updated_at", version)
    .select("id");
  if (error) throw new Error(`claimCancelNotice failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * F-048: the address a cancel notice for this booking would go to: its own
 * contact's email, trimmed, or null when there is none (or the booking is not
 * this account's). The Calendar page's Cancel reads it to decide whether a
 * notice can be scheduled at all; the notice reads the contact again when it
 * sends. THROWS on a read error.
 */
export async function bookingContactEmail(
  db: SupabaseClient, accountId: string, bookingId: string,
): Promise<string | null> {
  const { data, error } = await db.from("bookings").select("contacts(email)")
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`bookingContactEmail failed: ${error.message}`);
  const email = (data as { contacts: { email: string | null } | null } | null)?.contacts?.email?.trim();
  return email || null;
}

/**
 * F-048: the cancel notice's thread row is written QUEUED in the cancel
 * itself, before the Undo window (so a notice the server never got to send
 * stays visible as a stuck queued row instead of vanishing). When the Undo
 * wins, nothing was sent and the appointment is back on, so the row is
 * removed rather than marked: the only non-sent status the table has is
 * `failed`, which would tell the owner something went wrong when nothing
 * did. Only a QUEUED outbound email of this account is ever removed; a sent
 * or failed row is the record of what happened. Its `message.created` event
 * stays; nothing in the app reads that type. `true` when a row went.
 * THROWS on a delete error.
 *
 * Fix round 2 (M-b): the row's insert touched the conversation's
 * `last_message_at` (createMessage). After the delete it is put back to the
 * newest message left, or null when none is, so the inbox does not sort the
 * thread by an email that never existed. A conversation left with no
 * messages stays in place: harmless (it sorts last, nulls last) and the
 * next message on it reuses it. A failed reset is logged, not thrown: the
 * row is already gone, and the sort self-heals on the thread's next message.
 */
export async function discardQueuedNotice(
  db: SupabaseClient, accountId: string, messageId: string,
): Promise<boolean> {
  const { data, error } = await db.from("messages").delete()
    .eq("account_id", accountId).eq("id", messageId)
    .eq("status", "queued").eq("direction", "outbound").eq("channel", "email")
    .select("id, conversation_id");
  if (error) throw new Error(`discardQueuedNotice failed: ${error.message}`);
  const removed = (data ?? []) as { id: string; conversation_id: string }[];
  if (removed.length === 0) return false;

  // Round 3: a compare-and-set, never an unconditional write. A message can
  // land on this thread between the reads below and the write, and its touch
  // moves last_message_at to NOW; writing the older time over it would sort
  // a live thread down. So the value read first (V) is a predicate on the
  // write: zero rows matched means something newer already touched the
  // conversation, and it is left alone. (Comparing against the deleted row's
  // created_at could never match: that is the DB clock's default now(),
  // while createMessage's touch writes the app clock.)
  const conversationId = removed[0]!.conversation_id;
  const reset = async (): Promise<string | null> => {
    const { data: conv, error: convErr } = await db.from("conversations").select("last_message_at")
      .eq("account_id", accountId).eq("id", conversationId).maybeSingle();
    if (convErr) return convErr.message;
    if (!conv) return null;
    const seen = (conv as { last_message_at: string | null }).last_message_at;
    const { data: newest, error: newestErr } = await db.from("messages").select("created_at")
      .eq("account_id", accountId).eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }).limit(1);
    if (newestErr) return newestErr.message;
    let q = db.from("conversations")
      .update({ last_message_at: ((newest ?? []) as { created_at: string }[])[0]?.created_at ?? null })
      .eq("account_id", accountId).eq("id", conversationId);
    q = seen === null ? q.is("last_message_at", null) : q.eq("last_message_at", seen);
    const { error: resetErr } = await q;
    return resetErr ? resetErr.message : null;
  };
  const failure = await reset();
  if (failure) {
    console.error(`discardQueuedNotice: conversation ${conversationId} sort time not reset: ${failure}`);
  }
  return true;
}

/** F-048: the cancel notice's thread row's status, or null when there is no
 *  such row on this account. What an Undo refused as `superseded` reads to
 *  tell the owner, truthfully, whether the customer was emailed. THROWS on a
 *  read error. */
export async function noticeMessageStatus(
  db: SupabaseClient, accountId: string, messageId: string,
): Promise<string | null> {
  const { data, error } = await db.from("messages").select("status")
    .eq("account_id", accountId).eq("id", messageId).maybeSingle();
  if (error) throw new Error(`noticeMessageStatus failed: ${error.message}`);
  return (data as { status: string } | null)?.status ?? null;
}

/**
 * F-048 follow-up (0100): the cancel notice's durable copy, so the notice
 * outlives the process that queued it. Written by the Calendar page's cancel
 * in its own request, once the queued thread row exists; deleted by whoever
 * settles the notice (its `after()` job, its Undo, or the cron sweep). All
 * four accessors below are SERVICE-client only: 0100 grants anon and
 * authenticated nothing on the table.
 *
 * `email` is the composed email, fixed at queue time, opaque here (the app's
 * `ComposedCancelNotice`).
 */
export type PendingCancelNoticeWrite = {
  accountId: string; bookingId: string;
  /** The cancel's own `updatedAt` (`setBookingStatus`'s answer): what the notice claims. */
  version: string;
  messageId: string; userId: string; email: unknown;
  /** When the Undo window and its grace close. */
  dueAt: string;
};

export type PendingCancelNotice = Omit<PendingCancelNoticeWrite, "dueAt"> & {
  dueAt: string; createdAt: string;
  /** The appointment's start; null only when the embed found no booking. */
  startsAt: string | null;
};

/** UPSERTS on the booking: one live notice per booking, and a booking cancelled,
 *  undone and cancelled again belongs to its newest cancel (the older notice
 *  lost its claim either way). THROWS on a write error. */
export async function savePendingCancelNotice(db: SupabaseClient, row: PendingCancelNoticeWrite): Promise<void> {
  const { error } = await db.from("booking_cancel_notices").upsert({
    booking_id: row.bookingId, account_id: row.accountId, version: row.version, message_id: row.messageId,
    user_id: row.userId, email: row.email, due_at: row.dueAt,
  }, { onConflict: "booking_id" });
  if (error) throw new Error(`savePendingCancelNotice failed: ${error.message}`);
}

/** The cron sweep's read: rows due at or before `dueBy`, oldest due first,
 *  at most `limit`, every account's. THROWS on a read error. */
export async function listDueCancelNotices(
  db: SupabaseClient, dueBy: string, limit: number,
): Promise<PendingCancelNotice[]> {
  const { data, error } = await db.from("booking_cancel_notices")
    .select("booking_id, account_id, version, message_id, user_id, email, due_at, created_at, bookings(starts_at)")
    .lte("due_at", dueBy).order("due_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`listDueCancelNotices failed: ${error.message}`);
  return ((data ?? []) as unknown as {
    booking_id: string; account_id: string; version: string; message_id: string; user_id: string; email: unknown;
    due_at: string; created_at: string; bookings: { starts_at: string } | null;
  }[]).map((r) => ({
    bookingId: r.booking_id, accountId: r.account_id, version: r.version, messageId: r.message_id,
    userId: r.user_id, email: r.email, dueAt: r.due_at, createdAt: r.created_at, startsAt: r.bookings?.starts_at ?? null,
  }));
}

/** Settles ONE cancel's notice: only the row of this account, this booking
 *  and this cancel's version, so a newer cancel's row is never removed.
 *  `true` when a row went. THROWS on a delete error. */
export async function deletePendingCancelNotice(
  db: SupabaseClient, accountId: string, bookingId: string, version: string,
): Promise<boolean> {
  const { data, error } = await db.from("booking_cancel_notices").delete()
    .eq("account_id", accountId).eq("booking_id", bookingId).eq("version", version)
    .select("booking_id");
  if (error) throw new Error(`deletePendingCancelNotice failed: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

/** A booking's status, or null when this account has no such booking. What a
 *  cancel notice that lost its claim reads to tell an Undo (no longer
 *  cancelled) from another sender (still cancelled). THROWS on a read error. */
export async function readBookingStatus(
  db: SupabaseClient, accountId: string, bookingId: string,
): Promise<BookingStatus | null> {
  const { data, error } = await db.from("bookings").select("status")
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`readBookingStatus failed: ${error.message}`);
  return (data as { status: BookingStatus } | null)?.status ?? null;
}

/** How far `rescheduleChain` walks. A chain only grows by one row per move,
 *  so no real appointment comes near this; it bounds a corrupted one. */
const RESCHEDULE_CHAIN_MAX = 50;

/**
 * F-048: one appointment's identity across its reschedules. A move makes a
 * new row pointing at the one it replaced (`rescheduled_from_id`, 0061), so
 * the appointment is a chain; `rootId` is its first row and `depth` the
 * number of moves since. The add-to-calendar file uses them as its UID and
 * SEQUENCE, so a moved appointment updates the event a customer already
 * saved instead of adding a second one. Account-scoped at every hop; a
 * booking that is not this account's THROWS.
 */
export async function rescheduleChain(
  db: SupabaseClient, accountId: string, bookingId: string,
): Promise<{ rootId: string; depth: number }> {
  let id = bookingId;
  for (let depth = 0; depth <= RESCHEDULE_CHAIN_MAX; depth++) {
    const { data, error } = await db.from("bookings").select("id, rescheduled_from_id")
      .eq("account_id", accountId).eq("id", id).maybeSingle();
    if (error) throw new Error(`rescheduleChain failed: ${error.message}`);
    if (!data) throw new Error(`rescheduleChain: no booking ${id} for account ${accountId}`);
    const from = (data as { rescheduled_from_id: string | null }).rescheduled_from_id;
    if (!from) return { rootId: id, depth };
    id = from;
  }
  throw new Error(`rescheduleChain: booking ${bookingId} is more than ${RESCHEDULE_CHAIN_MAX} moves deep`);
}

/** F-048 part 2 (spec 3.2): the owner's feed window and its caps. */
export const FEED_PAST_DAYS = 30;
export const FEED_FUTURE_DAYS = 180;
export const FEED_FUTURE_CAP = 1500;
export const FEED_PAST_CAP = 300;
const FEED_STATUSES = ["booked", "completed", "no_show"] as const;
const FEED_DAY_MS = 86_400_000;
/** ids per `in()` on a chain hop: keeps a GET's URL well under PostgREST's limits. */
const ROOT_BATCH = 200;

/**
 * F-048 part 2: `rescheduleChain`'s answer for many rows at once, one account-scoped query per hop (per
 * ROOT_BATCH ids), never one query per row. A row whose chain leaves the account, cannot be read, or is
 * deeper than RESCHEDULE_CHAIN_MAX is LEFT OUT and logged (fail closed: no event, never a wrong UID).
 * THROWS on a read error.
 */
export async function rescheduleRoots(
  db: SupabaseClient, accountId: string, rows: readonly { id: string; rescheduled_from_id: string | null }[],
): Promise<Map<string, { rootId: string; depth: number }>> {
  const parent = new Map<string, string | null>();
  const missingForever = new Set<string>();
  for (const r of rows) parent.set(r.id, r.rescheduled_from_id);
  for (let hop = 0; hop < RESCHEDULE_CHAIN_MAX; hop++) {
    const want = [...new Set([...parent.values()])]
      .filter((p): p is string => p !== null && !parent.has(p) && !missingForever.has(p));
    if (want.length === 0) break;
    // One hop's batches go out together (final review m6); the hops themselves stay in order, because each
    // hop's ids are the parents the previous one found.
    const batches: string[][] = [];
    for (let i = 0; i < want.length; i += ROOT_BATCH) batches.push(want.slice(i, i + ROOT_BATCH));
    const answers = await Promise.all(batches.map((ids) => db.from("bookings").select("id, rescheduled_from_id")
      .eq("account_id", accountId).in("id", ids).limit(ids.length)));
    for (const [n, { data, error }] of answers.entries()) {
      const ids = batches[n]!;
      if (error) throw new Error(`rescheduleRoots failed: ${error.message}`);
      const got = new Set<string>();
      for (const r of (data ?? []) as { id: string; rescheduled_from_id: string | null }[]) {
        parent.set(r.id, r.rescheduled_from_id);
        got.add(r.id);
      }
      for (const id of ids) if (!got.has(id)) missingForever.add(id);
    }
  }
  const out = new Map<string, { rootId: string; depth: number }>();
  for (const r of rows) {
    let id = r.id;
    let depth = 0;
    let ok = true;
    for (;;) {
      const p = parent.get(id);
      if (p === null) break;
      if (p === undefined || missingForever.has(p) || !parent.has(p) || depth >= RESCHEDULE_CHAIN_MAX) { ok = false; break; }
      id = p;
      depth++;
    }
    if (ok) out.set(r.id, { rootId: id, depth });
    else console.error(`rescheduleRoots: booking ${r.id} has no root in account ${accountId}; left out of the feed`);
  }
  return out;
}

/** One row of a person's feed; structurally the web side's `FeedContentRow` (lib/booking/feed-content.ts). */
export type FeedBookingRow = {
  id: string; status: "booked" | "completed" | "no_show";
  starts_at: string; ends_at: string; updated_at: string; created_at: string;
  first_name: string | null; rootId: string; depth: number;
  /** F-046 (0107): this row's own kind; NULL = the calendar's (`meetingType` beside the rows). */
  meeting_type: BookingMeetingType | null;
};

type FeedRaw = {
  id: string; status: FeedBookingRow["status"]; starts_at: string; ends_at: string;
  updated_at: string; created_at: string; rescheduled_from_id: string | null;
  meeting_type: BookingMeetingType | null;
  contacts: { first_name: string | null; assigned_to: string | null } | null;
};

/**
 * F-048 part 2: the bookings one person's feed shows. The ACCOUNT's one calendar (0016's
 * calendars_one_per_account), live and past statuses only (a cancelled row is a cancel or a superseded
 * move, never an event), starts_at in [now - 30 d, now + 180 d), at most FEED_FUTURE_CAP upcoming and
 * FEED_PAST_CAP past. A Technician (technicianUserId) sees only customers assigned to them: 0068's
 * bookings_technician_scope restated, because the route reads with the service role. `truncated` says a
 * cap cut rows. THROWS on a read error.
 */
export async function listFeedBookings(
  db: SupabaseClient, accountId: string, o: { now: Date; technicianUserId: string | null },
): Promise<{
  meetingType: "in_person" | "phone" | "video"; rows: FeedBookingRow[]; truncated: boolean;
  /** Which cap cut rows: more than FEED_FUTURE_CAP upcoming, or more than FEED_PAST_CAP past (the route logs it). */
  capped: { upcoming: boolean; past: boolean };
}> {
  const { data: cal, error: calErr } = await db.from("calendars").select("id, meeting_type")
    .eq("account_id", accountId).maybeSingle();
  if (calErr) throw new Error(`listFeedBookings: calendar read failed: ${calErr.message}`);
  if (!cal) return { meetingType: "in_person", rows: [], truncated: false, capped: { upcoming: false, past: false } };
  const c = cal as { id: string; meeting_type: "in_person" | "phone" | "video" };
  const nowIso = o.now.toISOString();
  const fromIso = new Date(o.now.getTime() - FEED_PAST_DAYS * FEED_DAY_MS).toISOString();
  const toIso = new Date(o.now.getTime() + FEED_FUTURE_DAYS * FEED_DAY_MS).toISOString();
  const cols = "id, status, starts_at, ends_at, updated_at, created_at, rescheduled_from_id, meeting_type, contacts!inner(first_name, assigned_to)";
  const base = () => {
    let q = db.from("bookings").select(cols)
      .eq("account_id", accountId).eq("calendar_id", c.id).in("status", [...FEED_STATUSES]);
    if (o.technicianUserId !== null) q = q.eq("contacts.assigned_to", o.technicianUserId);
    return q;
  };
  const [up, past] = await Promise.all([
    base().gte("starts_at", nowIso).lt("starts_at", toIso).order("starts_at", { ascending: true }).limit(FEED_FUTURE_CAP + 1),
    base().gte("starts_at", fromIso).lt("starts_at", nowIso).order("starts_at", { ascending: false }).limit(FEED_PAST_CAP + 1),
  ]);
  if (up.error) throw new Error(`listFeedBookings: upcoming read failed: ${up.error.message}`);
  if (past.error) throw new Error(`listFeedBookings: past read failed: ${past.error.message}`);
  const upRows = (up.data ?? []) as unknown as FeedRaw[];
  const pastRows = (past.data ?? []) as unknown as FeedRaw[];
  const capped = { upcoming: upRows.length > FEED_FUTURE_CAP, past: pastRows.length > FEED_PAST_CAP };
  const truncated = capped.upcoming || capped.past;
  // Order: past rows newest first, then upcoming oldest first (each query's own order, so each cap keeps the
  // rows nearest today). Nothing downstream relies on it: feedEvents (apps/web lib/booking/feed-content.ts)
  // re-sorts the events by start.
  const raw = [...pastRows.slice(0, FEED_PAST_CAP), ...upRows.slice(0, FEED_FUTURE_CAP)];
  const roots = await rescheduleRoots(db, accountId, raw);
  const rows = raw.flatMap((r): FeedBookingRow[] => {
    const chain = roots.get(r.id);
    if (!chain) return [];
    return [{ id: r.id, status: r.status, starts_at: r.starts_at, ends_at: r.ends_at, updated_at: r.updated_at,
      created_at: r.created_at, first_name: r.contacts?.first_name ?? null, rootId: chain.rootId, depth: chain.depth,
      meeting_type: r.meeting_type ?? null }];
  });
  return { meetingType: c.meeting_type, rows, truncated, capped };
}

/** F-048: a move refused because the booking is not (or is no longer) a live
 *  booking of this account. Nothing was left written: either nothing was
 *  written at all, or the replacement was taken back out. */
export class BookingNotMovableError extends Error {
  constructor(message = "booking is not live, so it cannot be moved") {
    super(message);
    this.name = "BookingNotMovableError";
  }
}

/** F-046 (spec 6.3): what a person's Move on the Calendar page writes on the new row (`moveBooking`'s `to.job`). */
export type StaffMoveJob = {
  note: string | null; placeId: string | null; meetingType: BookingMeetingType;
  holdUntil: Date; closureKept: boolean;
};

/**
 * F-048: a customer moves their own booking (the link in their email). The
 * receptionist's reschedule, as a primitive, made safe for a link two tabs
 * can hold at once, and for a write that lands while what follows it fails.
 *
 *  1. read the row, this account's, and refuse anything not `booked`
 *     (`BookingNotMovableError`, nothing written);
 *  2. book the NEW range first, naming the old row (`rescheduled_from_id`,
 *     0061), carrying its contact, calendar, note and booker zone, and the
 *     request's `ipHash` (the public rate limit counts moves through it):
 *     never leave the customer with nothing. A taken range is
 *     `SlotTakenError`, nothing written. An unclear insert error (a dropped
 *     response) is settled by looking the row up by the token this call
 *     minted: there, the move goes on; absent, nothing was written; the
 *     look-up itself failing, the row is deleted BY THAT TOKEN (a no-op if it
 *     never landed) and the move fails;
 *  3. cancel the old row ONLY IF it is still `booked` — one conditional
 *     UPDATE that stamps `updated_at` with this call's own instant, so OUR
 *     cancel can be told from anyone else's (fix round 2, I1):
 *     - it matched: the move is DONE;
 *     - it matched nothing (another tab moved it, the business or the
 *       customer's link cancelled it): TAKE BACK — the new row is DELETED,
 *       not cancelled (it never was an appointment, and a cancelled row
 *       naming the old one would read as a move, `bookingWasMoved`, and
 *       block an Undo, `undoOperatorCancel`), then `BookingNotMovableError`;
 *     - an unclear error: the old row is read again. Cancelled AND carrying
 *       our stamp → our cancel landed behind the error, the move is done.
 *       Anything else — still booked, or cancelled by someone else in that
 *       window (whose own booking now stands) — the same take-back.
 *     - an unclear error AND a failed re-read: nobody can say whose cancel
 *       stands, so the move is ROLLED BACK: our cancel is undone where it
 *       carries our stamp, and only once that undo has answered is the new
 *       row deleted. If the undo itself fails the new row is kept: two live
 *       bookings is a defect someone can see; none is a lost customer.
 *     Every delete is retried once.
 *
 * EVENTS NEVER DECIDE THE OUTCOME (fix rounds 1 and 2). `booking.created`
 * and `booking.status_changed` are written only once the move is SETTLED, so
 * a taken-back move leaves no "booking created" for a row that is gone; a
 * failed event is logged and the move stands. An event cannot un-write a row.
 *
 * So a return leaves the NEW booking live and the old one cancelled by this
 * call; `BookingNotMovableError` and `SlotTakenError` leave no new row. A
 * plain Error means the move did not happen: what could be rolled back was,
 * and its message names both rows and what could not be settled.
 *
 * The new row gets its own cancel token (the old row's now opens a cancelled
 * booking), and `rescheduleChain` gives its calendar file the old row's UID
 * with the next SEQUENCE, so the event a customer saved is updated.
 *
 * `cancelledAt` is the stamp OUR cancel wrote on the old row: its version, as
 * `setBookingStatus`'s `updatedAt` is a cancel's. The phone receptionist's
 * reschedule records it on its act, the key 0091's Undo restores against;
 * reading the row afterwards could read someone else's later write.
 *
 * F-046 (0107). Without `to.job` (the customer's link, Sofía) the new row
 * also carries the old row's `place_id` and `meeting_type`, so a job staff
 * booked keeps its address and its kind when the customer moves it. With
 * `to.job` (a person moving a job on the Calendar page) the new row takes
 * the job's note, place, kind and closure keep, and is HELD (`hold_until`)
 * with `notice_wanted` NULL: the action decides the email after this call's
 * cancel, from a re-read of the old row (`setJobNotice`, plan review item 2).
 * A staff move writes NO events here: the settle of its new row writes them
 * (D8 extended), so a move undone inside its hold leaves no `booking.created`
 * for a row that was deleted.
 */
export async function moveBooking(
  db: SupabaseClient, accountId: string, bookingId: string,
  to: { startsAt: Date; endsAt: Date; meetingUrl?: string; ipHash?: string; job?: StaffMoveJob },
  actorId: string, actorType: ActorType = "user",
): Promise<{ id: string; cancelToken: string; cancelledAt: string }> {
  const { data, error } = await db.from("bookings")
    .select("id, calendar_id, contact_id, note, booker_timezone, status, place_id, meeting_type")
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`moveBooking read failed: ${error.message}`);
  const old = data as {
    id: string; calendar_id: string; contact_id: string;
    note: string | null; booker_timezone: string | null; status: BookingStatus;
    place_id: string | null; meeting_type: BookingMeetingType | null;
  } | null;
  if (!old || old.status !== "booked") throw new BookingNotMovableError();

  // --- 2. the new row ----------------------------------------------------
  const job = to.job;
  const input: CreateBookingInput = {
    calendarId: old.calendar_id, contactId: old.contact_id,
    startsAt: to.startsAt, endsAt: to.endsAt,
    note: (job ? job.note : old.note) ?? undefined, bookerTimezone: old.booker_timezone ?? undefined,
    meetingUrl: to.meetingUrl, rescheduledFromId: old.id, ipHash: to.ipHash,
  };
  const extra: BookingExtraColumns = job
    ? {
      place_id: job.placeId, meeting_type: job.meetingType, hold_until: job.holdUntil.toISOString(),
      notice_wanted: null, closure_kept_at: job.closureKept ? new Date().toISOString() : null,
    }
    : { place_id: old.place_id ?? null, meeting_type: old.meeting_type ?? null };
  const cancelToken = newCancelToken();
  // The new row, removed by the token only this call holds: idempotent, so
  // it is safe whether or not the row ever landed. Retried once. Answers the
  // last error, or null when the row is gone.
  const takeBack = async (): Promise<string | null> => {
    let last: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error: delErr } = await db.from("bookings").delete()
        .eq("account_id", accountId).eq("cancel_token", cancelToken);
      if (!delErr) return null;
      last = delErr.message;
    }
    return last;
  };

  const inserted = await insertBookingRow(db, accountId, input, cancelToken, bookingAuthor(actorType, actorId), extra);
  let newId: string;
  if (inserted.data && !inserted.error) {
    newId = inserted.data.id;
  } else {
    if (isOverlapError(inserted.error)) throw new SlotTakenError();
    // Unclear: did it land? The token is this call's alone, so it answers.
    const { data: found, error: findErr } = await db.from("bookings").select("id")
      .eq("account_id", accountId).eq("cancel_token", cancelToken).maybeSingle();
    if (findErr) {
      const left = await takeBack();
      throw new Error(`moveBooking: the replacement for ${old.id} could not be confirmed (insert: `
        + `${inserted.error?.message}; look-up: ${findErr.message}); `
        + (left ? `it may still exist, the delete by its token failed: ${left}` : "deleted by its token, if it landed"));
    }
    if (!found) throw new Error(`moveBooking: insert failed: ${inserted.error?.message}`);
    newId = (found as { id: string }).id;
    console.error(`moveBooking: replacement ${newId} for ${old.id} landed behind an error: ${inserted.error?.message}`);
  }

  // --- 3. the old row, only if it is still live, stamped as ours ---------
  const ourStamp = moveStamp();
  const { data: hit, error: cancelErr } = await db.from("bookings")
    .update({ status: "cancelled", updated_at: ourStamp })
    .eq("account_id", accountId).eq("id", old.id).eq("status", "booked")
    .select("id");
  let ours: boolean;
  if (!cancelErr) {
    ours = (hit?.length ?? 0) > 0;
  } else {
    const { data: again, error: againErr } = await db.from("bookings").select("status, updated_at")
      .eq("account_id", accountId).eq("id", old.id).maybeSingle();
    if (againErr) {
      // Nobody can say whose cancel stands: roll back. Undo OURS (it alone
      // carries our stamp; a no-op when it never landed), and only once that
      // undo has answered, delete the new row. A failed undo keeps the new
      // row: two live is visible, none is a lost customer.
      const { error: undoErr } = await db.from("bookings")
        .update({ status: "booked", updated_at: new Date().toISOString() })
        .eq("account_id", accountId).eq("id", old.id).eq("status", "cancelled").eq("updated_at", ourStamp)
        .select("id");
      const left = undoErr ? `not attempted, the undo of ${old.id}'s cancel failed: ${undoErr.message}` : await takeBack();
      throw new Error(`moveBooking: cannot tell whether ${old.id} was cancelled (cancel: ${cancelErr.message}; `
        + `re-read: ${againErr.message}); rolled back` + (left ? `, but ${newId} may still be live (${left})` : ""));
    }
    const row = again as { status: BookingStatus; updated_at: string } | null;
    // OURS only when cancelled AND carrying our stamp, to the microsecond
    // (`sameMicroInstant`: PostgREST answers "+00:00", not "Z").
    ours = row?.status === "cancelled" && sameMicroInstant(row.updated_at, ourStamp);
    console.error(`moveBooking: the cancel of ${old.id} answered an error (${cancelErr.message}); `
      + `re-read says ${ours ? "it landed, so the move stands" : "it did not land as ours, so the move is taken back"}`);
  }

  if (!ours) {
    const left = await takeBack();
    if (left) {
      throw new Error(`moveBooking: ${old.id} was not cancelled by this move and its replacement ${newId} `
        + `could not be taken back: ${left}`);
    }
    throw new BookingNotMovableError();
  }

  // --- 4. settled: the events, which never undo it -----------------------
  // F-046: a staff move's events are its settle's (D8 extended), so none here.
  if (!job) {
    await emitLogged(db, accountId, "booking.created", actorId,
      { bookingId: newId, calendarId: input.calendarId, contactId: input.contactId }, actorType);
    await emitLogged(db, accountId, "booking.status_changed", actorId,
      { bookingId: old.id, status: "cancelled" }, actorType);
  }
  return { id: newId, cancelToken, cancelledAt: ourStamp };
}

/**
 * Fix round 3 (m2): the `updated_at` a move's cancel writes. Now's
 * millisecond plus three random digits of microseconds (timestamptz keeps
 * them and PostgREST answers them), so two moves cancelling in the same
 * millisecond collide only 1 time in 1000 — not unique, but no longer the
 * certainty a millisecond-only stamp was. `sameMicroInstant` compares them.
 */
export function moveStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/Z$/, `${String(randomInt(0, 1000)).padStart(3, "0")}Z`);
}

/** Whether two timestamps name the same instant to the MICROSECOND, whatever
 *  their zone spelling or trailing zeros ("…123400Z" = "…1234+00:00").
 *  `Date` keeps only milliseconds, so the fraction is read from the text. */
export function sameMicroInstant(a: string, b: string): boolean {
  const micros = (iso: string): number | null => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    const frac = /:\d\d\.(\d+)/.exec(iso)?.[1] ?? "";
    return Math.floor(ms / 1000) * 1_000_000 + Number(frac.slice(0, 6).padEnd(6, "0"));
  };
  const x = micros(a);
  const y = micros(b);
  return x !== null && y !== null && x === y;
}

/** An event written AFTER the row it describes, where the row is the truth:
 *  a failure is logged, never thrown (`moveBooking`'s rule). */
async function emitLogged(
  db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object, actorType: ActorType,
): Promise<void> {
  try {
    await emit(db, accountId, type, actorId, payload, actorType);
  } catch (e) {
    console.error(`moveBooking: ${type} event not recorded for ${JSON.stringify(payload)}: ${String(e)}`);
  }
}

/** F-048: whether a move replaced this booking (a row of this account names
 *  it in `rescheduled_from_id`). The cancel and move pages read it so an old
 *  link says "moved", not "cancelled". THROWS on a read error. */
export async function bookingWasMoved(
  db: SupabaseClient, accountId: string, bookingId: string,
): Promise<boolean> {
  const { data, error } = await db.from("bookings").select("id")
    .eq("account_id", accountId).eq("rescheduled_from_id", bookingId).limit(1);
  if (error) throw new Error(`bookingWasMoved failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** F-046 (spec 5.2): how many bookings the agenda draws for one window at most. */
export const AGENDA_ROW_CAP = 400;
// The two embeds name their CONSTRAINT: a column hint resolves only against a single-column FK, and both are
// composite (0050's note; bookings_place_fkey is 0107's). The place embed is the second FK from bookings, and
// the live probe in test/booking.test.ts ("F-046 part 1", case c) proves PostgREST still reads it unambiguously.
const AGENDA_COLS = "id, contact_id, starts_at, ends_at, status, note, author_kind, author_id, meeting_type, meeting_url, place_id, "
  + "confirm_reply, hold_until, hold_settled_at, notice_wanted, notice_sent_at, rescheduled_from_id, created_at, "
  + "contact:contacts!bookings_contact_id_fkey(first_name, last_name, phone, email), place:places!bookings_place_fkey(label, address)";

export type AgendaBookingRow = {
  id: string; contact_id: string; starts_at: string; ends_at: string; status: BookingStatus; note: string | null;
  author_kind: AuthorKind; author_id: string | null; meeting_type: BookingMeetingType | null; meeting_url: string | null;
  place_id: string | null; confirm_reply: "yes" | "no" | null; hold_until: string | null; hold_settled_at: string | null;
  notice_wanted: NoticeWanted | null; notice_sent_at: string | null; rescheduled_from_id: string | null; created_at: string;
  contact: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null;
  place: { label: string | null; address: string | null } | null;
  /** Cancelled AND a row of this account names it in `rescheduled_from_id`: a move replaced it. */
  replaced: boolean;
};

/**
 * F-046 (spec 5.2): every booking overlapping [fromIso, toIso), any status, soonest first (then by id, so the
 * same rows always read the same way), at most AGENDA_ROW_CAP; `truncated` says the cap cut rows. Overlap,
 * not "starts inside": a job from 23:00 to 01:00 is on both days. On the CALLER's client: RLS (0068) decides
 * what a Technician sees, so no "busy" block of anyone else's job can exist to draw (R5). A cancelled row a
 * move replaced is marked `replaced`, in one extra read per ROOT_BATCH cancelled ids (the feed's URL bound).
 * THROWS on a read error.
 */
export async function listAgendaBookings(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<{ rows: AgendaBookingRow[]; truncated: boolean }> {
  const { data, error } = await db.from("bookings").select(AGENDA_COLS)
    .eq("account_id", accountId).lt("starts_at", toIso).gt("ends_at", fromIso)
    .order("starts_at", { ascending: true }).order("id", { ascending: true }).limit(AGENDA_ROW_CAP + 1);
  if (error) throw new Error(`listAgendaBookings failed: ${error.message}`);
  const raw = (data ?? []) as unknown as Omit<AgendaBookingRow, "replaced">[];
  const rows = raw.slice(0, AGENDA_ROW_CAP);
  const cancelled = rows.filter((r) => r.status === "cancelled").map((r) => r.id);
  const batches: string[][] = [];
  for (let i = 0; i < cancelled.length; i += ROOT_BATCH) batches.push(cancelled.slice(i, i + ROOT_BATCH));
  const answers = await Promise.all(batches.map((ids) => db.from("bookings").select("rescheduled_from_id")
    .eq("account_id", accountId).in("rescheduled_from_id", ids)));
  const replaced = new Set<string>();
  for (const { data: links, error: lErr } of answers) {
    if (lErr) throw new Error(`listAgendaBookings (replaced) failed: ${lErr.message}`);
    for (const l of (links ?? []) as { rescheduled_from_id: string }[]) replaced.add(l.rescheduled_from_id);
  }
  return { rows: rows.map((r) => ({ ...r, replaced: replaced.has(r.id) })), truncated: raw.length > AGENDA_ROW_CAP };
}

/** F-046 (spec 5.5): one job for the drawer and `?job=`, on the caller's client. null = not this caller's to
 *  see. A cancelled row reads `bookingWasMoved` once, so a moved job is told from a cancelled one here too.
 *  THROWS on a read error. */
export async function readAgendaJob(db: SupabaseClient, accountId: string, bookingId: string): Promise<AgendaBookingRow | null> {
  const { data, error } = await db.from("bookings").select(AGENDA_COLS)
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`readAgendaJob failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Omit<AgendaBookingRow, "replaced">;
  const replaced = row.status === "cancelled" && await bookingWasMoved(db, accountId, bookingId);
  return { ...row, replaced };
}

/** F-046 (spec 5.4, Move's tick): the customer knows this appointment when its chain's first row is theirs or
 *  Sofía's, or any row of the chain had its email sent. Walks `rescheduleChain`'s way, account-scoped at
 *  every hop; a row it cannot read answers false (nothing proves they were told). THROWS on a read error. */
export async function jobWasTold(db: SupabaseClient, accountId: string, bookingId: string): Promise<boolean> {
  let id: string | null = bookingId;
  for (let hop = 0; id && hop <= RESCHEDULE_CHAIN_MAX; hop++) {
    const { data, error } = await db.from("bookings").select("author_kind, notice_sent_at, rescheduled_from_id")
      .eq("account_id", accountId).eq("id", id).maybeSingle();
    if (error) throw new Error(`jobWasTold failed: ${error.message}`);
    const r = data as { author_kind: AuthorKind; notice_sent_at: string | null; rescheduled_from_id: string | null } | null;
    if (!r) return false;
    if (r.notice_sent_at) return true;
    if (!r.rescheduled_from_id) return r.author_kind === "customer" || r.author_kind === "ai";
    id = r.rescheduled_from_id;
  }
  return false;
}

/** F-046 (spec 5.2, "Earlier days"): started and over before `beforeIso`, still booked (work-queue.ts's
 *  staleBookings predicate). An exact head count; THROWS on a count-less answer (head-count-null) or an error. */
export async function countAwaitingOutcomeBefore(db: SupabaseClient, accountId: string, beforeIso: string): Promise<number> {
  const { count, error } = await db.from("bookings").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("status", "booked").lt("ends_at", beforeIso);
  if (error) throw new Error(`countAwaitingOutcomeBefore failed: ${error.message}`);
  if (count === null) throw new Error("countAwaitingOutcomeBefore failed: no count returned");
  return count;
}

const CLAIM_COLS = "id, status, notice_wanted, starts_at, ends_at, contact_id, calendar_id, place_id, meeting_url, "
  + "cancel_token, rescheduled_from_id, author_id, hold_until, created_at";
export type JobHoldClaim = {
  id: string; status: BookingStatus; notice_wanted: NoticeWanted | null; starts_at: string; ends_at: string;
  contact_id: string; calendar_id: string; place_id: string | null; meeting_url: string | null; cancel_token: string;
  rescheduled_from_id: string | null; author_id: string | null; hold_until: string; created_at: string;
};

/**
 * F-046 (spec 6.5): the hold's one claim. Conditional on the hold being due and unclaimed, so the after()
 * job, the pass and the Undo's delete serialise on the row and exactly one wins. Writes ONLY
 * `hold_settled_at`: never `updated_at` (a cancel's version, plan correction 13), and no column 0107's trigger
 * watches, so it takes no calendar lock. Only a BOOKED row is claimed (plan review item 2): a hold that falls
 * due while a move has its row cancelled stays unclaimed, so an Undo of that move brings back a row whose
 * confirmation can still go. null = someone else won, the row is not booked, or nothing is due. THROWS on a
 * write error.
 */
export async function claimJobHold(db: SupabaseClient, accountId: string, bookingId: string, nowIso: string): Promise<JobHoldClaim | null> {
  const { data, error } = await db.from("bookings").update({ hold_settled_at: nowIso })
    .eq("account_id", accountId).eq("id", bookingId).eq("status", "booked")
    .lte("hold_until", nowIso).is("hold_settled_at", null)
    .select(CLAIM_COLS);
  if (error) throw new Error(`claimJobHold failed: ${error.message}`);
  return ((data ?? []) as unknown as JobHoldClaim[])[0] ?? null;
}

/** F-046: send-then-stamp (stampReminderSent's reasoning): only after the gate said SENT. THROWS on a write error. */
export async function stampJobNoticeSent(db: SupabaseClient, accountId: string, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings").update({ notice_sent_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", bookingId);
  if (error) throw new Error(`stampJobNoticeSent failed: ${error.message}`);
}

/** F-046 (plan review item 2): a staff move's email, decided AFTER moveBooking's cancel of the old row (the
 *  action re-reads that row). Only while the new row's hold is unsettled, so the settle reads one settled
 *  value. true = written. THROWS on a write error. */
export async function setJobNotice(db: SupabaseClient, accountId: string, bookingId: string, notice: NoticeWanted | null): Promise<boolean> {
  const { data, error } = await db.from("bookings").update({ notice_wanted: notice })
    .eq("account_id", accountId).eq("id", bookingId).not("hold_until", "is", null).is("hold_settled_at", null).select("id");
  if (error) throw new Error(`setJobNotice failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** F-046: the jobHolds pass's read, every account (service role): booked rows whose hold is due by
 *  `beforeIso` and unclaimed (index bookings_hold_due), oldest first, at most `limit`. THROWS on a read error. */
export async function listDueJobHolds(db: SupabaseClient, beforeIso: string, limit: number):
  Promise<{ accountId: string; bookingId: string; holdUntil: string }[]> {
  const { data, error } = await db.from("bookings").select("id, account_id, hold_until")
    .eq("status", "booked").lte("hold_until", beforeIso).is("hold_settled_at", null)
    .order("hold_until", { ascending: true }).limit(limit);
  if (error) throw new Error(`listDueJobHolds failed: ${error.message}`);
  return ((data ?? []) as { id: string; account_id: string; hold_until: string }[])
    .map((r) => ({ accountId: r.account_id, bookingId: r.id, holdUntil: r.hold_until }));
}

export type UndoAddOutcome = "deleted" | "settled" | "moved" | "is_move" | "not_yours" | "gone";

/**
 * F-046 (D5): the Undo of an add DELETES the row while its hold is unsettled (0091's reason: a cancelled row
 * would still count as a booking made and sit on the timeline). Only the person who added it, and only an
 * ADD: a held row a move made (`rescheduled_from_id` set) is never deleted here, or its old row would stay
 * cancelled and the customer would have no appointment at all (plan review item 3); that answers "is_move".
 * A DELETE fires no 0107 trigger and restores nothing, so it takes no calendar lock. Zero rows is told apart
 * by one re-read. THROWS on a write or read error.
 */
export async function deleteUnsettledStaffJob(
  db: SupabaseClient, accountId: string, bookingId: string, actorId: string,
): Promise<UndoAddOutcome> {
  const { data, error } = await db.from("bookings").delete()
    .eq("account_id", accountId).eq("id", bookingId).eq("author_kind", "person").eq("author_id", actorId)
    .eq("status", "booked").is("rescheduled_from_id", null).is("hold_settled_at", null).not("hold_until", "is", null)
    .select("id");
  if (error) throw new Error(`deleteUnsettledStaffJob failed: ${error.message}`);
  if ((data?.length ?? 0) > 0) return "deleted";
  const { data: row, error: rErr } = await db.from("bookings").select("status, author_id, hold_settled_at, rescheduled_from_id")
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (rErr) throw new Error(`deleteUnsettledStaffJob re-read failed: ${rErr.message}`);
  const r = row as { status: BookingStatus; author_id: string | null; hold_settled_at: string | null; rescheduled_from_id: string | null } | null;
  if (!r) return "gone";
  if (r.status === "booked" && r.rescheduled_from_id) return "is_move";
  if (r.status === "cancelled" && await bookingWasMoved(db, accountId, bookingId)) return "moved";
  if (r.hold_settled_at) return "settled";
  if (r.author_id !== actorId) return "not_yours";
  return "gone";
}

export type UndoStaffMoveOutcome = "undone" | "gone" | "too_late" | "time_taken" | "changed";
const UNDO_MOVE_ANSWERS: readonly UndoStaffMoveOutcome[] = ["undone", "gone", "too_late", "time_taken", "changed"];
/** Postgres's deadlock_detected. */
const UNDO_MOVE_DEADLOCK = "40P01";

/**
 * F-046 (D6, spec 3.3): the Undo of a staff move, 0107's `undo_staff_move` (service role only). Its answers
 * pass through; anything else THROWS. A deadlock is run again ONCE (client-groups.ts's shape): the RPC is one
 * transaction, so a 40P01 rolled all of it back and the second call starts clean. The function takes the
 * calendar row first, but a single-statement write that sets a booking back to `booked` takes the booking row
 * first (moveBooking's roll-back, setBookingStatus's Undo), so the two can still meet in a cycle (T1 review).
 * A second deadlock THROWS.
 */
export async function undoStaffMove(
  db: SupabaseClient, accountId: string, newId: string, oldId: string, cancelledAt: string, now: Date,
): Promise<UndoStaffMoveOutcome> {
  const args = { p_account_id: accountId, p_new_id: newId, p_old_id: oldId, p_cancelled_at: cancelledAt, p_now: now.toISOString() };
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await db.rpc("undo_staff_move", args);
    if (error) {
      if (error.code === UNDO_MOVE_DEADLOCK && attempt === 0) continue;
      throw new Error(`undoStaffMove failed: ${error.message}`);
    }
    if (!UNDO_MOVE_ANSWERS.includes(data as UndoStaffMoveOutcome)) throw new Error(`undoStaffMove: unexpected answer ${String(data)}`);
    return data as UndoStaffMoveOutcome;
  }
}

export type JobDetails = { note: string | null; placeId: string | null; meetingType: BookingMeetingType | null; meetingUrl: string | null };

/** F-046 (D6): a Move that keeps the time is an in-place edit, compare-and-set on what the form opened with
 *  (`is` for a NULL: `eq` NULL matches nothing). Writes none of 0107's watched columns and never `updated_at`
 *  (a cancel's version, plan correction 13). true = written. THROWS on a write error. */
export async function editJobDetails(
  db: SupabaseClient, accountId: string, bookingId: string, from: JobDetails, to: JobDetails,
): Promise<boolean> {
  let q = db.from("bookings").update({ note: to.note, place_id: to.placeId, meeting_type: to.meetingType, meeting_url: to.meetingUrl })
    .eq("account_id", accountId).eq("id", bookingId).eq("status", "booked");
  const pairs: [string, string | null][] = [
    ["note", from.note], ["place_id", from.placeId], ["meeting_type", from.meetingType], ["meeting_url", from.meetingUrl],
  ];
  for (const [col, v] of pairs) q = v === null ? q.is(col, null) : q.eq(col, v);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`editJobDetails failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** How many started-but-unmarked bookings the operator's list carries at
 *  most — the same cap the To do screen's stale-booking source uses. */
const AWAITING_OUTCOME_LIMIT = 200;

/**
 * The operator's list, `fromIso` forward — no status filter, deliberately:
 * the operator page shows status per row (booked/cancelled/completed/no_show)
 * with actions to change it, so a cancelled booking still needs to be visible
 * as "cancelled", not silently dropped from the list.
 *
 * D-030: "forward" is measured on `ends_at`, not `starts_at`, so an
 * appointment in progress stays on the list; and every appointment that is
 * over but still `booked` — waiting for its "Completed" or "No-show", the
 * same rows the To do screen's stale-booking source lists — rides along
 * too, oldest first. Before this the list dropped an appointment the moment
 * it started, which is exactly when it could first be given an outcome.
 *
 * Named `listCalendarBookings`, not `listUpcomingBookings` (its name until
 * D-030's review): it returns past rows too, so the old name lied.
 */
export async function listCalendarBookings(
  db: SupabaseClient, accountId: string, fromIso: string,
): Promise<(BookingRow & { contact_name: string; contact_email: string | null; contact_language: string | null })[]> {
  const cols = `${BOOKING_COLS}, contacts(first_name, last_name, email, language)`;
  const [current, awaiting] = await Promise.all([
    db.from("bookings").select(cols)
      .eq("account_id", accountId).gte("ends_at", fromIso)
      .order("starts_at", { ascending: true }),
    db.from("bookings").select(cols)
      .eq("account_id", accountId).eq("status", "booked").lt("ends_at", fromIso)
      .order("starts_at", { ascending: false }).limit(AWAITING_OUTCOME_LIMIT),
  ]);
  if (current.error) throw new Error(`listCalendarBookings failed: ${current.error.message}`);
  if (awaiting.error) throw new Error(`listCalendarBookings (awaiting outcome) failed: ${awaiting.error.message}`);
  const data = [...((awaiting.data ?? []) as any[]).reverse(), ...((current.data ?? []) as any[])];
  return data.map((r) => {
    const { contacts, ...rest } = r;
    const contactName = [contacts?.first_name, contacts?.last_name]
      .filter(Boolean).join(" ").trim();
    return {
      ...(rest as BookingRow),
      contact_name: contactName || "Unknown",
      contact_email: contacts?.email ?? null,
      contact_language: contacts?.language ?? null,
    };
  });
}

/**
 * When this contact's soonest upcoming `booked` appointment starts, or null.
 * For the consent CANCEL To-do (spec §4.2 step 2): a customer who texts
 * CANCEL has stopped their texts, and staff check whether they also meant
 * the appointment. THROWS on a read error (the inbound route retries).
 */
export async function nextBookedStart(
  db: SupabaseClient, accountId: string, contactId: string, nowIso: string,
): Promise<string | null> {
  const { data, error } = await db.from("bookings")
    .select("starts_at")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("status", "booked")
    .gt("starts_at", nowIso)
    .order("starts_at", { ascending: true }).limit(1);
  if (error) throw new Error(`nextBookedStart failed: ${error.message}`);
  return ((data ?? []) as { starts_at: string }[])[0]?.starts_at ?? null;
}

/**
 * Raw `created_at` instants in `[fromIso, toIso)` for the dashboard's 14-day
 * bookings chart — bucketing happens in JS on the caller side, not here.
 * Deliberately no status filter, unlike `listBookedRanges`: "pipeline
 * added"-style capture is the CREATED count, so a later cancel must not
 * erase a bar this account already earned.
 *
 * D-035 (0061): a row with `rescheduled_from_id` set is a reschedule, not a
 * new booking, and is left out; the original it replaced keeps its bar. This
 * is the ONE read behind every "bookings" count (the dashboard's number and
 * chart, the Monday report, the agency roll-up), so they all agree.
 */
export async function listBookingCreationsBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<string[]> {
  const { data, error } = await db.from("bookings")
    .select("created_at")
    .eq("account_id", accountId).gte("created_at", fromIso).lt("created_at", toIso)
    .is("rescheduled_from_id", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listBookingCreationsBetween failed: ${error.message}`);
  return (data ?? []).map((r: { created_at: string }) => r.created_at);
}

/**
 * "Booked {n} times" on a customer's record (S-03 part 1, spec C8/D14): the bookings MADE for one
 * customer, by the SAME definition as `listBookingCreationsBetween` (D-035, the ONE read behind
 * every "bookings" count): a reschedule (`rescheduled_from_id` set) is not a new booking, and a
 * booking cancelled later still counts. An exact head count, never a list. Runs on the caller's
 * client, so RLS (0068's Technician fence) decides what is counted. THROWS on a read error.
 */
export async function countContactBookingsMade(
  db: SupabaseClient, accountId: string, contactId: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("contact_id", contactId)
    .is("rescheduled_from_id", null);
  if (error) throw new Error(`countContactBookingsMade failed: ${error.message}`);
  // A count-less response (`count: null`, `error: null`) is not "zero": it is how
  // postgrest-js 2.110.8 reads a HEAD request's empty 404 body as "204 No
  // Content" (dist/index.cjs:429-431), so a failed read must not read back as
  // "booked 0 times" -- the caller (contactFacts' settle) can only tell a real
  // zero from a failed read if this throws instead of guessing.
  if (count === null) throw new Error("countContactBookingsMade failed: no count returned");
  return count;
}

/**
 * "Booked {n} times" for a household's set (S-03 part 2b, spec C8/D14): the same D-035 definition
 * as `countContactBookingsMade`, across every id in `contactIds`, via `forContacts`. An empty set
 * reads nothing and answers 0 (a group with no members has nothing to count, and PostgREST's
 * `in.()` is not a query anyone means). THROWS on a read error or a count-less answer, same as
 * `countContactBookingsMade`.
 */
export async function countBookingsMadeFor(
  db: SupabaseClient, accountId: string, contactIds: readonly string[],
): Promise<number> {
  if (contactIds.length === 0) return 0;
  const { count, error } = await forContacts(
    db.from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId),
    "contact_id", contactIds,
  ).is("rescheduled_from_id", null);
  if (error) throw new Error(`countBookingsMadeFor failed: ${error.message}`);
  if (count === null) throw new Error("countBookingsMadeFor failed: no count returned");
  return count;
}

export type UpcomingBooking = { id: string; starts_at: string; contact_id: string };

/**
 * The record's "Next up" bookings (S-03 part 1, spec §7; 2b: a household's set, `forContacts`).
 * Still `booked`, starting at or after `nowIso`, soonest first across every id given, at most
 * `limit`. No calendar label: there is one calendar per account (`calendars_one_per_account`, 0016)
 * and it has no name column. THROWS on a read error.
 */
export async function listContactUpcomingBookings(
  db: SupabaseClient, accountId: string, contactId: string | readonly string[], nowIso: string, limit = 3,
): Promise<UpcomingBooking[]> {
  const { data, error } = await forContacts(
    db.from("bookings")
      .select("id, contact_id, starts_at")
      .eq("account_id", accountId),
    "contact_id", contactId,
  ).eq("status", "booked")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true }).order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listContactUpcomingBookings failed: ${error.message}`);
  return (data ?? []).map((r: UpcomingBooking) => ({ id: r.id, starts_at: r.starts_at, contact_id: r.contact_id }));
}

export type ContactBookingRow = {
  id: string; contact_id: string; created_at: string; starts_at: string; status: BookingStatus; note: string | null;
  // NOT NULL since 0074 (the migration backfilled every row the build before 1b had written, then
  // closed the column).
  author_kind: AuthorKind; author_id: string | null; rescheduled_from_id: string | null;
  /** The replaced booking's start ("Moved from …"), when this row is a reschedule and that row is readable. */
  moved_from_starts_at: string | null;
};

/**
 * The record timeline's bookings (S-03 part 1, 1b; 2b: a household's set, `forContacts`; spec §6):
 * one page by (created_at desc, id desc). A booking row reads "booked an appointment for {when}":
 * no calendar label, there is one calendar per account (`calendars_one_per_account`, 0016) and it
 * has no name column. A reschedule (0061) carries the start it replaced, read in ONE extra query
 * for the page. Runs on the caller's client, so RLS (0068's Technician fence) decides what is read.
 * THROWS on a read error.
 */
export async function listContactBookings(
  db: SupabaseClient, accountId: string, contactId: string | readonly string[], page: TimelinePageOpts,
): Promise<ContactBookingRow[]> {
  const { data, error } = await withTimelinePage(
    forContacts(
      db.from("bookings")
        .select("id, contact_id, created_at, starts_at, status, note, author_kind, author_id, rescheduled_from_id")
        .eq("account_id", accountId),
      "contact_id", contactId,
    ),
    "created_at", page);
  if (error) throw new Error(`listContactBookings failed: ${error.message}`);
  const rows = (data ?? []) as Omit<ContactBookingRow, "moved_from_starts_at">[];
  const fromIds = [...new Set(rows.flatMap((r) => (r.rescheduled_from_id ? [r.rescheduled_from_id] : [])))];
  const movedFrom = new Map<string, string>();
  if (fromIds.length > 0) {
    const { data: olds, error: oErr } = await db.from("bookings").select("id, starts_at")
      .eq("account_id", accountId).in("id", fromIds);
    if (oErr) throw new Error(`listContactBookings (moved from) failed: ${oErr.message}`);
    for (const o of (olds ?? []) as { id: string; starts_at: string }[]) movedFrom.set(o.id, o.starts_at);
  }
  return rows.map((r) => ({
    ...r, moved_from_starts_at: r.rescheduled_from_id ? movedFrom.get(r.rescheduled_from_id) ?? null : null,
  }));
}

/** Rate limiting for the public booking submit: same shape as forms' countRecentSubmissions. */
export async function countRecentBookings(
  db: SupabaseClient, calendarId: string, ipHash: string, windowStartIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("calendar_id", calendarId).eq("ip_hash", ipHash).gte("created_at", windowStartIso);
  if (error) throw new Error(`countRecentBookings failed: ${error.message}`);
  if (count === null) throw new Error("countRecentBookings failed: no count returned");
  return count;
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
  "mailing_address, " +
  // S-09 PR 2 (0065, its second reader since 0076): the language of scheduled messages to a contact with none.
  "language";

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

/**
 * D-029, the LATE reminder: a booking made less than the day-before window's
 * span ahead (`created_at > starts_at - REMINDER_WINDOW_END_MS`) may never have
 * been inside that window on any tick, so it gets ONE reminder 3h-4h15m
 * before it starts instead — provided it was made at least
 * `LATE_REMINDER_MIN_AGE_MS` before the tick that sends it, because the
 * confirmation already went out at booking time and a reminder minutes later
 * is noise. In practice: booked at least ~4 hours ahead → reminded ~3-4
 * hours ahead; booked closer than that → the confirmation is the reminder.
 *
 * 75 minutes wide for the same tick-tolerance reason as the day-before
 * window, and it ends far below `REMINDER_WINDOW_START_MS`, so one tick can
 * never list a booking under both windows.
 *
 * THE TEXT REMINDER. Inside the sending hours (08:00-21:00, the email's AND
 * the text's) the late window closes 45 minutes before the text reminder's
 * opens (`SMS_REMINDER_WINDOW_END_MS`, 2h15m). That alone does NOT keep them
 * apart: OUTSIDE the hours both are held and both are released at 08:00 — a
 * 09:00 appointment booked at 19:00 the evening before had its email (due
 * 05:45) and its text (due 06:45-07:30) land together at 08:00. So every
 * reminder row carries `late` (`isLateBooking`), and the reminders pass gives
 * a late one an earlier deadline — the start minus 2h15m
 * (`reminderDeadline`, apps/web/src/lib/booking/reminder-timing.ts) — past
 * which a held email is dropped instead of released.
 *
 * ACCEPTED, and the price of that rule: a late-booked appointment at or
 * before about 10:15 whose late window falls before 08:00 — an early-morning
 * appointment booked the evening before — gets NO separate reminder email;
 * the confirmation and the text are its reminders. With texting OFF for the
 * row (no `textCovers`), the late email's deadline is the start minus 45
 * minutes instead (S-09 PR 2, `MORNING_OF_MIN_NOTICE_MS`): held overnight, it
 * is released at 08:00 for every appointment after 08:45.
 * Both the no-collision property and those exact costs are proved by sweeps
 * over a whole day of appointments and booking times, through the real
 * sending-hours functions, in apps/web's cron-coupling.test.ts.
 */
export const LATE_REMINDER_WINDOW_START_MS = 3 * 60 * 60 * 1000;
export const LATE_REMINDER_WINDOW_END_MS = (4 * 60 + 15) * 60 * 1000;
export const LATE_REMINDER_MIN_AGE_MS = 60 * 60 * 1000;

/** "Made late" (D-029): booked less than the day-before window's whole span
 *  (24h15m) ahead, so that window may never have seen it. The ONE rule both
 *  the late window's filter and `DueReminder.late` use. */
export function isLateBooking(createdAtIso: string, startsAtIso: string): boolean {
  return new Date(createdAtIso).getTime() > new Date(startsAtIso).getTime() - REMINDER_WINDOW_END_MS;
}

export type AccountBrandInfo = {
  accountTimezone: string; branding: Branding;
  fromEmail: string | null; replyToEmail: string | null;
  /** Migration 0032. True = every pass skips this account's due work. */
  outboundSuppressed: boolean;
  /** Migration 0048. The postal address the reactivation email prints; null
   *  = not set. Carried as stored, untrimmed: the pass judges blankness. */
  mailingAddress: string | null;
  /** 0065. NULL = no preference. Read by recipientLanguage in every due-list's mapper (S-09 L3). */
  accountLanguage: RecipientLanguage | null;
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
      language: string | null;
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
      accountLanguage: acct.language === "en" || acct.language === "es" ? acct.language : null,
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

/** An embed a due row reaches through an FK, and the noun its log line uses. */
const EMBED_NOUN = { contacts: "contact", calendars: "calendar" } as const;
export type AccountEmbed = keyof typeof EMBED_NOUN;

/**
 * EVERY EMBED MUST BE THE ROW'S OWN ACCOUNT'S — every due-list that reaches
 * the customer, or the calendar a link is built from, through an FK:
 * `bookings.contact_id`, `bookings.calendar_id`, `opportunities.contact_id`.
 *
 * Until 0050 all three were single-column FKs, so a booking in account A
 * could point at a contact or a calendar of account B. The embed followed the
 * FK with no account condition of its own, and everything downstream would
 * have followed it too: the send, under A's brand, to B's customer's address,
 * or a link to B's public booking page.
 * Migration 0050 makes all three composite FKs onto `(account_id, id)`, so
 * that row can no longer be written; this guard stays as defence in depth.
 * `listDueReactivations` has guarded its own join this way since the #111
 * audit (A1); automations.ts's recipes since 36e8c89 (`ownAccountContactOnly`,
 * now a delegate of this); the booking reminder and follow-up since B22.
 *
 * FAIL CLOSED: a row is kept only when EVERY named embed's `account_id`
 * EQUALS the row's. A missing embed, or a select that forgot `account_id`
 * inside one, drops the row rather than passing it — every *_SELECT that
 * comes through here carries `account_id` inside each embed it names.
 * Logged by id and by embed, because a row like this is a data defect
 * somebody must fix, and silence would hide it. The by-id reads answer
 * `gone`, so a released hold leaves the queue.
 */
export function ownAccountEmbedsOnly<T>(
  rows: T[], fn: string, what: "booking" | "opportunity", embeds: readonly AccountEmbed[],
): T[] {
  return rows.filter((r) => {
    const row = r as { id: string; account_id: string } & Partial<Record<AccountEmbed, { account_id?: string } | null>>;
    for (const embed of embeds) {
      const got = row[embed];
      if (got?.account_id === row.account_id) continue;
      console.error(
        `${fn}: ${what} ${row.id} (account ${row.account_id}) points at a ${EMBED_NOUN[embed]} of `
        + `${got ? `account ${got.account_id}` : "no readable account"} — dropped; nothing is sent for it`,
      );
      return false;
    }
    return true;
  });
}

const REMINDER_SELECT = `id, account_id, contact_id, starts_at, created_at, booker_timezone, cancel_token, meeting_url, closure_kept_at,
             calendars(account_id, public_id), contacts(account_id, first_name, last_name, email, phone, language)`;

/** F-046 (0107): no Undo hold, or a hold already claimed. The forward due-lists' filter (spec 6.5, section 17). */
const HOLD_SETTLED_OR_NONE = "hold_until.is.null,hold_settled_at.not.is.null";

function toDueReminder(r: any, info: AccountBrandInfo): DueReminder {
  const contactName = [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(" ").trim();
  return {
    bookingId: r.id, accountId: r.account_id, contactId: r.contact_id, startsAt: r.starts_at,
    closureKeptAt: r.closure_kept_at ?? null,
    bookerTimezone: r.booker_timezone ?? null, cancelToken: r.cancel_token,
    calendarPublicId: r.calendars?.public_id, contactEmail: r.contacts?.email ?? null,
    contactName: contactName || "Unknown", accountTimezone: info.accountTimezone,
    branding: info.branding, fromEmail: info.fromEmail, meetingUrl: r.meeting_url ?? null,
    late: isLateBooking(r.created_at, r.starts_at),
    language: recipientLanguage(r.contacts?.language, info.accountLanguage),
    contactPhone: r.contacts?.phone ?? null,
  };
}

export async function listDueReminders(
  db: SupabaseClient, nowIso: string,
): Promise<DueReminder[]> {
  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + REMINDER_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + REMINDER_WINDOW_END_MS).toISOString();

  // F-046: a staff job is reminded only once its Undo hold is SETTLED, so the confirmation (the settle sends
  // it) always comes first, and a job undone before its claim never gets a reminder. Gated on the claim, never
  // on hold_until: the clock passing proves nothing was settled (plan review item 4). Both reads carry it; the
  // by-id twin deliberately does not (plan correction 3).
  const { data, error } = await db.from("bookings")
    .select(REMINDER_SELECT)
    .eq("status", "booked").is("reminder_sent_at", null).or(HOLD_SETTLED_OR_NONE)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueReminders failed: ${error.message}`);

  // D-029: the late window (see LATE_REMINDER_WINDOW_START_MS). Disjoint from
  // the day-before window on `starts_at` at any one `now`, so no row can come
  // back from both reads. "Made late" compares two columns of the same row,
  // which a PostgREST filter cannot express, so it is applied here; the
  // window and the minimum age bound the read itself.
  const { data: lateData, error: lateError } = await db.from("bookings")
    .select(REMINDER_SELECT)
    .eq("status", "booked").is("reminder_sent_at", null).or(HOLD_SETTLED_OR_NONE)
    .gte("starts_at", new Date(now + LATE_REMINDER_WINDOW_START_MS).toISOString())
    .lte("starts_at", new Date(now + LATE_REMINDER_WINDOW_END_MS).toISOString())
    .lte("created_at", new Date(now - LATE_REMINDER_MIN_AGE_MS).toISOString())
    .order("starts_at", { ascending: true });
  if (lateError) throw new Error(`listDueReminders (late) failed: ${lateError.message}`);
  const late = ((lateData ?? []) as any[]).filter((r) =>
    isLateBooking(r.created_at, r.starts_at));

  // The contact AND the calendar (whose public id is the reschedule link)
  // must be this booking's own account's (ownAccountEmbedsOnly). Late rows
  // first: their appointments are hours away, the day-before rows' a day.
  const rows = ownAccountEmbedsOnly([...late, ...((data ?? []) as any[])], "listDueReminders", "booking", ["contacts", "calendars"]);
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
  if (ownAccountEmbedsOnly([data], "getDueReminderById", "booking", ["contacts", "calendars"]).length === 0) {
    return { due: null, why: "gone" };
  }
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
// contacts!inner (0103, review Q2): archived means no new conversation. `!inner`
// is load-bearing, not decoration — PostgREST only turns an embed filter into a
// row-excluding join when the embed is `!inner`; without it `.is("contacts.archived_at",
// null)` below would filter the nested object and leave the booking row itself intact.
const FOLLOWUP_SELECT = `id, account_id, contact_id, starts_at, ends_at, closure_kept_at, calendars!inner(account_id, followup_body, followup_body_es, followup_enabled), contacts!inner(account_id, first_name, last_name, email, language, archived_at)`;

function toDueFollowup(r: any, info: AccountBrandInfo): DueFollowup {
  const contactName = [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(" ").trim();
  return {
    bookingId: r.id, accountId: r.account_id, contactId: r.contact_id, startsAt: r.starts_at, endsAt: r.ends_at,
    closureKeptAt: r.closure_kept_at ?? null,
    contactEmail: r.contacts?.email ?? null, contactName: contactName || "Unknown",
    accountTimezone: info.accountTimezone, branding: info.branding,
    fromEmail: info.fromEmail, replyToEmail: info.replyToEmail, followupBody: r.calendars?.followup_body ?? "",
    language: recipientLanguage(r.contacts?.language, info.accountLanguage),
    followupBodyEs: r.calendars?.followup_body_es ?? null,
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
    // Contact archive (0103), owner ruling Q2: archived means no new conversation. In the QUERY, never after the page: a bounded page full of archived rows would starve the rest (cf. :1510-1527).
    .is("contacts.archived_at", null)
    // Widened past "booked": an operator's "Mark completed" on the list
    // must not silence the follow-up this feature exists to send.
    // no_show stays excluded -- deliberately deferred, not an oversight.
    .in("status", ["booked", "completed"]).is("followup_sent_at", null)
    .eq("calendars.followup_enabled", true)
    .gte("ends_at", windowStart).lte("ends_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueFollowups failed: ${error.message}`);

  // The contact AND the calendar (whose words are the body) must be this
  // booking's own account's (ownAccountEmbedsOnly).
  const rows = ownAccountEmbedsOnly((data ?? []) as any[], "listDueFollowups", "booking", ["contacts", "calendars"]);
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
    // Contact archive (0103), owner ruling Q2: archived means no new conversation. In the QUERY, never after the page: a bounded page full of archived rows would starve the rest (cf. :1510-1527).
    .is("contacts.archived_at", null)
    .eq("id", bookingId).in("status", ["booked", "completed"]).is("followup_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueFollowupById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  // Before the `followup_enabled` read: that flag means something only on
  // the booking's OWN calendar.
  if (ownAccountEmbedsOnly([data], "getDueFollowupById", "booking", ["contacts", "calendars"]).length === 0) {
    return { due: null, why: "gone" };
  }
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
