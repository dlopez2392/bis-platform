"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import {
  serviceDb, getCalendarForAccount, readAccountTimezone, getContact, listContactsOnNumber, createContact, readPersonId,
  listContactPlaces, addPlace, listBookedRanges, createStaffJob, moveBooking, setJobNotice, readAgendaJob,
  deleteUnsettledStaffJob, undoStaffMove, editJobDetails, emit, BookingNotMovableError,
  type BookingMeetingType, type CalendarRow, type NoticeWanted, type SupabaseClient, type AgendaBookingRow, type JobDetails,
} from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { isDateKey } from "@/lib/business-status/status";
import { readSlotClosures, slotConfigFrom } from "@/lib/booking/availability";
import { jobWarnings, warningKey, type JobWarning } from "@/lib/booking/job-warnings";
import { wallToInstant } from "@/lib/booking/agenda-window";
import { parsePlaceFields } from "@/lib/contacts/place-input";
import { getMeetingProvider } from "@/lib/meetings/provider";
import { isCallerIdNumber } from "@/lib/voice/phone-number";
import { originFrom } from "@/lib/email/origin";
import { loggableError } from "@/lib/loggable-error";
import { settleAfterWindow, jobNoticeAvailability } from "./job-hold";
import { proveBooking } from "./prove-booking";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";
import type { NoticeAvailability } from "./cancel-flow";

/**
 * F-046 part 1 (spec 6.1-6.3, plan Task 10): the agenda's writes. Who may: the agency, an Owner, Staff
 * (`seesWholeAccount`); a Technician, or a role that could not be settled, is refused before anything is read
 * (spec 8.1; Technicians keep Completed / No-show on their own customers' jobs through actions.ts, owner
 * decision 1). A paused account is refused by `requireAccountAccess` itself: no action here asks to run
 * during a pause, the notice-option read included (the add it serves is refused).
 *
 * Reads that decide what the person may touch are on the request client, so RLS and the account id bind them:
 * the calendar, the zone, the customer (getContact), the places (listContactPlaces), the live ranges and the
 * closures. A booking id is proven with `proveBooking` (callerCanSee, the caller's own client) before anything
 * names it. The service client is used only for the bookings writes (authenticated holds no INSERT, UPDATE or
 * DELETE on bookings, 0053), the move's re-read of the old row (plan review item 2) and the two suppression
 * reads inside `jobNoticeAvailability`. A contact and a place are written on the request client, as their own
 * cards write them.
 *
 * The clock is read once per action and passed down. Every answer is data (keys and ISO times), never words:
 * the sheet and the drawer translate it (T11). The customer is told nothing here: a job's email goes when its
 * hold settles (job-hold.ts), after the Undo window.
 */

export type JobCustomer = { kind: "existing"; id: string } | { kind: "new"; name: string; phone: string; addAsNew: boolean };
export type JobFields = { date: string; start: string; minutes: number; what: string; placeId: string | null;
  meetingType: BookingMeetingType; notify: boolean };
export type JobDraft = JobFields & { customer: JobCustomer;
  /** A new address typed in the sheet: the raw fields `parsePlaceFields` reads. The ACTION saves it on the
   *  customer, after the customer exists (a quick-add makes them first) and before the job; `placeId` is then
   *  ignored. Plan review minor: a place needs its contact first. */
  newPlace?: unknown };
export type JobWarningView = { key: string; kind: "outside_hours" | "notice" | "closed" | "overlaps" | "no_video";
  count?: number; at?: string };
export type JobErrorKey = "calendar.job.past" | "calendar.job.noSuchTime" | "calendar.job.changed" | "calendar.job.saveFailed";
export type AddJobResult =
  | { ok: true; bookingId: string; startsAt: string; first: string; notice: "scheduled" | "none" | "no_email" | "address_blocked" }
  | { ok: false; needs: { phoneOwner: { id: string; name: string; first: string } } | { warnings: JobWarningView[] } }
  | { ok: false; errorKey: JobErrorKey };
export type UndoAddResult = { ok: true } | { ok: false; errorKey: "calendar.job.undoTooLate" | "calendar.job.undoMovedSince" | "calendar.bookings.statusUpdateFailed";
  /** The Undo cannot delete this row: its hold already settled, or it is a MOVE's new row ("is_move"). The drawer's
   *  Cancel then runs the ordinary cancel flow instead (plan review item 3). */
  fallback?: true };
export type JobOpened = { startsAt: string; endsAt: string; note: string | null; placeId: string | null;
  meetingType: BookingMeetingType | null; meetingUrl: string | null };
/** What Move opened with, plus whether the customer had been told about this job THEN (the drawer's `told`,
 *  T10 review I2). Required: the move's email is decided against it. */
export type MoveOpened = JobOpened & { told: boolean };
export type MoveJobResult =
  | { ok: true; mode: "edited"; from: JobOpened; to: JobOpened }
  | { ok: true; mode: "moved"; newId: string; oldId: string; cancelledAt: string; startsAt: string; first: string; notice: "scheduled" | "none" }
  | { ok: false; needs: { warnings: JobWarningView[] } }
  | { ok: false; errorKey: JobErrorKey };
export type UndoMoveResult = { ok: true; startsAt: string }
  | { ok: false; errorKey: "calendar.job.moveUndoTaken" | "calendar.job.undoTooLate" | "calendar.job.changed" | "calendar.bookings.statusUpdateFailed" };

const DAY_MS = 86_400_000;
/** Spec 6.1: a job starts within 366 days. */
const HORIZON_MS = 366 * DAY_MS;
const MEETING_TYPES: readonly BookingMeetingType[] = ["in_person", "phone", "video"];
const WHAT_MAX = 200;
const NAME_MAX = 200;
const PHONE_MAX = 40;
const URL_MAX = 2000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const saveFailed = { ok: false, errorKey: "calendar.job.saveFailed" } as const;
const changed = { ok: false, errorKey: "calendar.job.changed" } as const;
const statusFailed = { ok: false, errorKey: "calendar.bookings.statusUpdateFailed" } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isMeetingType = (v: unknown): v is BookingMeetingType => typeof v === "string" && (MEETING_TYPES as readonly string[]).includes(v);
const isIsoTime = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const calendarPath = (accountId: string) => `/dashboard/accounts/${accountId}/calendar`;
const trimmedOrNull = (v: string | null | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

type Fields = { date: string; start: string; minutes: number; note: string | null; placeId: string | null;
  meetingType: BookingMeetingType; notify: boolean };

/** The sheet's fields, re-checked: a server action is an endpoint like any other. null = refused. */
function parseFields(raw: unknown): Fields | null {
  if (!isRecord(raw)) return null;
  const { date, start, minutes, what, placeId, meetingType, notify } = raw;
  if (typeof date !== "string" || !isDateKey(date)) return null;
  const hm = typeof start === "string" ? HHMM.exec(start) : null;
  if (!hm || Number(hm[2]) % 5 !== 0) return null;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 5 || minutes > 720 || minutes % 5 !== 0) return null;
  if (typeof what !== "string") return null;
  const note = what.trim();
  if (note.length > WHAT_MAX) return null;
  if (!(placeId === null || isUuid(placeId))) return null;
  if (!isMeetingType(meetingType)) return null;
  if (typeof notify !== "boolean") return null;
  return { date, start: start as string, minutes, note: note === "" ? null : note,
    placeId: placeId === null ? null : placeId.toLowerCase(), meetingType, notify };
}

type Customer = { kind: "existing"; id: string } | { kind: "new"; firstName: string; lastName: string | null; phone: string; addAsNew: boolean };

function parseCustomer(raw: unknown): Customer | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "existing") return isUuid(raw.id) ? { kind: "existing", id: raw.id.toLowerCase() } : null;
  if (raw.kind !== "new" || typeof raw.name !== "string" || typeof raw.phone !== "string" || typeof raw.addAsNew !== "boolean") return null;
  const name = raw.name.trim().replace(/\s+/g, " ");
  if (name === "" || name.length > NAME_MAX || raw.phone.length > PHONE_MAX) return null;
  const space = name.indexOf(" ");
  return { kind: "new", firstName: space < 0 ? name : name.slice(0, space), lastName: space < 0 ? null : name.slice(space + 1),
    phone: raw.phone, addAsNew: raw.addAsNew };
}

function parseOpened(raw: unknown): JobOpened | null {
  if (!isRecord(raw)) return null;
  const { startsAt, endsAt, note, placeId, meetingType, meetingUrl } = raw;
  if (!isIsoTime(startsAt) || !isIsoTime(endsAt)) return null;
  if (!(note === null || (typeof note === "string" && note.length <= WHAT_MAX))) return null;
  if (!(placeId === null || isUuid(placeId))) return null;
  if (!(meetingType === null || isMeetingType(meetingType))) return null;
  if (!(meetingUrl === null || (typeof meetingUrl === "string" && meetingUrl.length <= URL_MAX))) return null;
  return { startsAt, endsAt, note, placeId: placeId === null ? null : placeId.toLowerCase(), meetingType, meetingUrl };
}

/** parseOpened, and `told` must be a boolean. The answer's `opened` carries no `told`: it is the row's snapshot. */
function parseMoveOpened(raw: unknown): { opened: JobOpened; told: boolean } | null {
  const opened = parseOpened(raw);
  if (!opened || !isRecord(raw) || typeof raw.told !== "boolean") return null;
  return { opened, told: raw.told };
}

const seenKeys = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
const detailsOf = (o: JobOpened): JobDetails => ({ note: o.note, placeId: o.placeId, meetingType: o.meetingType, meetingUrl: o.meetingUrl });

function viewOf(w: JobWarning): JobWarningView {
  return w.kind === "overlaps"
    ? { key: warningKey(w), kind: "overlaps", count: w.ids.length, at: w.firstStart.toISOString() }
    : { key: warningKey(w), kind: w.kind };
}
const NO_VIDEO: JobWarningView = { key: "no_video", kind: "no_video" };

/** The calendar and the account's zone, on the request client. null = neither can be trusted. THROWS on a read error. */
async function calendarAndZone(db: SupabaseClient, accountId: string): Promise<{ calendar: CalendarRow; tz: string } | null> {
  const [calendar, tz] = await Promise.all([getCalendarForAccount(db, accountId), readAccountTimezone(db, accountId)]);
  return calendar && tz ? { calendar, tz } : null;
}

type Range = { startsAt: Date; endsAt: Date };
/** The job's range in the account's wall time, or the refusal it earns. Past and too far are refused, never warned. */
function rangeOf(f: Fields, tz: string, now: Date): Range | JobErrorKey {
  const startsAt = wallToInstant(f.date, f.start, tz);
  if (!startsAt) return "calendar.job.noSuchTime";
  if (startsAt.getTime() < now.getTime()) return "calendar.job.past";
  if (startsAt.getTime() > now.getTime() + HORIZON_MS) return "calendar.job.saveFailed";
  return { startsAt, endsAt: new Date(startsAt.getTime() + f.minutes * 60_000) };
}

/** Spec 6.1 step 5: what this time breaks, read off what the slot engine reads (the live ranges and the closures). */
async function warningsFor(
  db: SupabaseClient, calendar: CalendarRow, tz: string, now: Date, range: Range, excludeId: string | null,
): Promise<{ refused: "past" | "invalid" | null; warnings: JobWarning[] }> {
  const [booked, closures] = await Promise.all([
    listBookedRanges(db, calendar.id, range.startsAt.toISOString(), range.endsAt.toISOString()),
    readSlotClosures(db, calendar.account_id, tz, now),
  ]);
  return jobWarnings({
    config: { ...slotConfigFrom(calendar, tz), closures },
    liveRanges: booked.map((b) => ({ id: b.id, startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at) })),
    now, range, excludeId,
  });
}

/** A video room for a job ending at `endsAt` (the public page's call). null = no provider, or it failed: a
 *  room is never worth a job. Never logs the url. */
async function mintRoom(calendar: CalendarRow, endsAt: Date, tag: string): Promise<string | null> {
  const provider = getMeetingProvider();
  if (!provider) return null;
  try {
    return (await provider.createMeetingRoom({ bookingId: calendar.public_id, endsAt })).url;
  } catch (e) {
    console.error(`${tag}: createMeetingRoom failed: ${loggableError(e)}`);
    return null;
  }
}

/** A saved place the job may name: one of this customer's (or their households') ACTIVE places, as the caller's
 *  own client reads them. `archivedToo`: an archived one of theirs counts as well (an Undo writing back the place
 *  the job named before, which an edit keeps even once archived). */
async function placeIsCustomers(
  db: SupabaseClient, accountId: string, contactId: string, placeId: string, archivedToo = false,
): Promise<boolean> {
  const { places } = await listContactPlaces(db, accountId, contactId);
  return places.some((p) => p.id.toLowerCase() === placeId && (archivedToo || p.archived_at === null));
}

const holdUntilFrom = (now: Date) => new Date(now.getTime() + UNDO_WINDOW_MS + NOTICE_GRACE_MS);

/**
 * Spec 6.1: Add job. Writes nothing until everything the person has not yet seen has been shown: the phone's
 * owner (R8), then each warning (R3) and the missing video link. Then, in order: the customer when new
 * (createContact, email-only, so a phone match can never fold the job onto somebody else, carry-in 4), the
 * new address on that customer (addPlace, the places card's own writer), the room, and the job, held for the
 * Undo window. The confirmation goes when the hold settles (after(), or the jobHolds pass). A quick-add
 * contact, or a new address, stays if a later step fails or the job is undone: staff typed a real person.
 */
export async function addJobAction(accountId: string, draft: JobDraft, seen: string[]): Promise<AddJobResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return saveFailed;
  const f = parseFields(draft);
  const customer = parseCustomer(isRecord(draft) ? draft.customer : undefined);
  if (!f || !customer) return saveFailed;
  const rawPlace = isRecord(draft) ? draft.newPlace : undefined;
  let newPlace: ReturnType<typeof parsePlaceFields> | null = null;
  if (rawPlace !== undefined && rawPlace !== null) {
    newPlace = parsePlaceFields(rawPlace);
    if (!newPlace.ok) return saveFailed;
  }
  // A customer typed in the sheet has no saved places yet: only a new address can be theirs.
  if (customer.kind === "new" && !newPlace && f.placeId !== null) return saveFailed;
  const accepted = seenKeys(seen);
  const now = new Date();
  const tag = `addJobAction (account ${accountId})`;

  const db = await dbForRequest();
  try {
    const cz = await calendarAndZone(db, accountId);
    if (!cz) return saveFailed;
    const { calendar, tz } = cz;
    const range = rangeOf(f, tz, now);
    if (typeof range === "string") return { ok: false, errorKey: range };

    let contactId: string | null = null;
    let first = "";
    if (customer.kind === "existing") {
      const c = await getContact(db, accountId, customer.id) as {
        first_name?: string | null; archived_at?: string | null; merged_into?: string | null; holds_shared_number?: boolean;
      } | null;
      if (!c || c.archived_at || c.merged_into || c.holds_shared_number) return saveFailed;
      contactId = customer.id;
      first = trimmedOrNull(c.first_name) ?? "";
      if (!newPlace && f.placeId !== null && !(await placeIsCustomers(db, accountId, contactId, f.placeId))) return saveFailed;
    } else {
      first = customer.firstName;
      const e164 = normalisePhone(customer.phone)?.e164 ?? null;
      if (e164 && !customer.addAsNew) {
        const { rows } = await listContactsOnNumber(db, accountId, e164);
        const owner = rows.find((r) => !r.holds_shared_number && isCallerIdNumber(r.phone, e164));
        if (owner) {
          const ownerFirst = trimmedOrNull(owner.first_name) ?? "";
          const name = [owner.first_name, owner.last_name].map((x) => trimmedOrNull(x)).filter((x): x is string => x !== null).join(" ");
          return { ok: false, needs: { phoneOwner: { id: owner.id, name, first: ownerFirst } } };
        }
      }
    }

    const check = await warningsFor(db, calendar, tz, now, range, null);
    if (check.refused === "past") return { ok: false, errorKey: "calendar.job.past" };
    if (check.refused) return saveFailed;
    const views = check.warnings.map(viewOf);
    const provider = f.meetingType === "video" ? getMeetingProvider() : null;
    if (f.meetingType === "video" && !provider) views.push(NO_VIDEO);
    if (views.some((v) => !accepted.includes(v.key))) return { ok: false, needs: { warnings: views } };

    // Read before any write: past the job's write, nothing may turn a saved job into "Couldn't save".
    const origin = originFrom(await headers());
    // --- writes, in order: the customer, the address, the room, the job ---
    if (customer.kind === "new") {
      const assignedTo = await readPersonId(db, accountId, access.userId);
      // AS TYPED (F-009): createContact stores the E.164 when it reads, the text otherwise. matchBy email_only:
      // with no email this always makes a new person, and a number someone has is filed for the merge queue.
      const created = await createContact(db, accountId, {
        firstName: customer.firstName, ...(customer.lastName ? { lastName: customer.lastName } : {}),
        ...(customer.phone.trim() ? { phone: customer.phone } : {}), matchBy: "email_only", assignedTo,
      }, access.userId, "user");
      contactId = created.id;
    }
    if (!contactId) return saveFailed;
    let placeId = newPlace ? null : f.placeId;
    if (newPlace?.ok) {
      const place = await addPlace(db, accountId, { contactId, groupId: null }, newPlace.fields, { subjectId: contactId, actorId: access.userId });
      placeId = place.id.toLowerCase();
    }
    const meetingUrl = f.meetingType === "video" ? await mintRoom(calendar, range.endsAt, tag) : null;

    let availability: NoticeAvailability | null = null;
    if (f.notify) {
      try {
        availability = await jobNoticeAvailability(db, serviceDb(), accountId, contactId);
      } catch (e) {
        // Fail open to the job, never to an email nobody could check: no confirmation is asked for.
        console.error(`${tag}: notice check failed, the job saves with no confirmation: ${loggableError(e)}`);
      }
    }
    const noticeWanted: NoticeWanted | null = availability === "available" ? "confirmation" : null;
    const { id: bookingId } = await createStaffJob(serviceDb(), accountId, {
      calendarId: calendar.id, contactId, startsAt: range.startsAt, endsAt: range.endsAt, note: f.note, placeId,
      meetingType: f.meetingType, meetingUrl, holdUntil: holdUntilFrom(now), noticeWanted,
      closureKept: check.warnings.some((w) => w.kind === "closed"),
    }, access.userId);

    after(() => settleAfterWindow(accountId, bookingId, origin));
    revalidatePath(calendarPath(accountId));
    const notice = !f.notify ? "none"
      : availability === "available" ? "scheduled"
      : availability === "no_email" || availability === "address_blocked" ? availability
      : "none";
    return { ok: true, bookingId, startsAt: range.startsAt.toISOString(), first, notice };
  } catch (e) {
    console.error(`${tag} failed: ${loggableError(e)}`);
    return saveFailed;
  }
}

/**
 * Spec 6.2 (D5): the Undo of an add DELETES the row while its hold is unsettled, only the caller's own add, never
 * a move's row (plan review item 3). The answers that cannot delete tell the drawer to run the ordinary Cancel
 * instead (`fallback`): a settled hold (the confirmation went), a held move, and a colleague's held add (T10 review).
 */
export async function undoAddJobAction(accountId: string, bookingId: string): Promise<UndoAddResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(bookingId)) return statusFailed;
  if (await proveBooking("undoAddJobAction", accountId, bookingId)) return statusFailed;
  let outcome;
  try {
    outcome = await deleteUnsettledStaffJob(serviceDb(), accountId, bookingId, access.userId);
  } catch (e) {
    console.error(`undoAddJobAction: failed for booking ${bookingId} (account ${accountId}): ${loggableError(e)}`);
    return statusFailed;
  }
  if (outcome === "settled") return { ok: false, errorKey: "calendar.job.undoTooLate", fallback: true };
  if (outcome === "is_move") return { ok: false, errorKey: "calendar.bookings.statusUpdateFailed", fallback: true };
  // A colleague's held add: only its author may delete it, but anyone who sees the whole account may Cancel it.
  if (outcome === "not_yours") return { ok: false, errorKey: "calendar.bookings.statusUpdateFailed", fallback: true };
  if (outcome === "moved") return { ok: false, errorKey: "calendar.job.undoMovedSince" };
  if (outcome !== "deleted") return statusFailed;
  try {
    await emit(await dbForRequest(), accountId, "booking.add_undone", access.userId, { bookingId }, "user");
  } catch (e) {
    console.error(`undoAddJobAction: booking ${bookingId} removed, its event not recorded: ${loggableError(e)}`);
  }
  revalidatePath(calendarPath(accountId));
  return { ok: true };
}

/**
 * Spec 6.3 (D6): Move. The same start and length is an in-place edit (note, address, kind) by compare-and-set on
 * what the form opened with, no new row and no email. A new time is `moveBooking` with the job's details, held
 * like an add; a video job gets a new room for its new end (carry-in 1: the old room expires at the old end).
 * Its email is decided AFTER the move cancelled the old row, from a re-read of it (plan review item 2): the old
 * row's own confirmation still unclaimed means the customer never heard of the old time, so they get the
 * confirmation; otherwise "moved" when ticked. Nothing can claim the old row after the cancel (claims take
 * booked rows only), so the re-read is final.
 *
 * Lock rule (T1 review, carry-in 3): this restores nothing. moveBooking's cancel of the old row can meet an Undo
 * of an EARLIER move of the same job in a deadlock; it answers that with its own take-back
 * (BookingNotMovableError, or a plain Error: nothing left written), and `undoStaffMove` retries its side once.
 * A retry here could only meet the Undo's committed result (the old row gone), so the answer is a refusal.
 */
export async function moveJobAction(
  accountId: string, bookingId: string, draft: JobFields & { opened: MoveOpened }, seen: string[],
): Promise<MoveJobResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(bookingId)) return saveFailed;
  const f = parseFields(draft);
  const snapshot = parseMoveOpened(isRecord(draft) ? draft.opened : undefined);
  if (!f || !snapshot) return saveFailed;
  const { opened, told: toldAtOpen } = snapshot;
  const accepted = seenKeys(seen);
  const now = new Date();
  const tag = `moveJobAction: booking ${bookingId} (account ${accountId})`;
  if (await proveBooking("moveJobAction", accountId, bookingId)) return saveFailed;

  const db = await dbForRequest();
  let current: AgendaBookingRow;
  let cz: { calendar: CalendarRow; tz: string };
  try {
    const [row, found] = await Promise.all([readAgendaJob(db, accountId, bookingId), calendarAndZone(db, accountId)]);
    if (!found) return saveFailed;
    if (!row || row.status !== "booked") return changed;
    current = row;
    cz = found;
  } catch (e) {
    console.error(`${tag}: reads failed: ${loggableError(e)}`);
    return saveFailed;
  }
  const { calendar, tz } = cz;
  const first = trimmedOrNull(current.contact?.first_name) ?? "";
  try {
    if (f.placeId !== null && f.placeId !== current.place_id?.toLowerCase()
      && !(await placeIsCustomers(db, accountId, current.contact_id, f.placeId))) return saveFailed;
  } catch (e) {
    console.error(`${tag}: place read failed: ${loggableError(e)}`);
    return saveFailed;
  }

  const startsAt = wallToInstant(f.date, f.start, tz);
  if (!startsAt) return { ok: false, errorKey: "calendar.job.noSuchTime" };
  const endsAt = new Date(startsAt.getTime() + f.minutes * 60_000);
  const sameTime = startsAt.getTime() === Date.parse(current.starts_at) && endsAt.getTime() === Date.parse(current.ends_at);
  const provider = f.meetingType === "video" ? getMeetingProvider() : null;

  if (sameTime) {
    // The in-place edit: no time rule applies (the time is the job's own); only the missing video link.
    const wasVideo = (opened.meetingType ?? calendar.meeting_type) === "video";
    const needsRoom = f.meetingType === "video" && !(wasVideo && opened.meetingUrl);
    const views = needsRoom && !provider ? [NO_VIDEO] : [];
    if (views.some((v) => !accepted.includes(v.key))) return { ok: false, needs: { warnings: views } };
    const meetingUrl = f.meetingType !== "video" ? null
      : needsRoom ? await mintRoom(calendar, endsAt, tag) : opened.meetingUrl;
    const to: JobOpened = { ...opened, note: f.note, placeId: f.placeId, meetingType: f.meetingType, meetingUrl };
    try {
      if (!(await editJobDetails(serviceDb(), accountId, bookingId, detailsOf(opened), detailsOf(to)))) return changed;
    } catch (e) {
      console.error(`${tag}: edit failed: ${loggableError(e)}`);
      return saveFailed;
    }
    revalidatePath(calendarPath(accountId));
    return { ok: true, mode: "edited", from: opened, to };
  }

  if (startsAt.getTime() < now.getTime()) return { ok: false, errorKey: "calendar.job.past" };
  if (startsAt.getTime() > now.getTime() + HORIZON_MS) return saveFailed;
  const range = { startsAt, endsAt };
  let check;
  let availability: NoticeAvailability | null = null;
  try {
    check = await warningsFor(db, calendar, tz, now, range, bookingId);
    try {
      availability = await jobNoticeAvailability(db, serviceDb(), accountId, current.contact_id);
    } catch (e) {
      console.error(`${tag}: notice check failed, the move asks for no email: ${loggableError(e)}`);
    }
  } catch (e) {
    console.error(`${tag}: reads failed: ${loggableError(e)}`);
    return saveFailed;
  }
  if (check.refused === "past") return { ok: false, errorKey: "calendar.job.past" };
  if (check.refused) return saveFailed;
  const views = check.warnings.map(viewOf);
  if (f.meetingType === "video" && !provider) views.push(NO_VIDEO);
  if (views.some((v) => !accepted.includes(v.key))) return { ok: false, needs: { warnings: views } };

  const origin = originFrom(await headers());
  const meetingUrl = f.meetingType === "video" ? await mintRoom(calendar, endsAt, tag) : null;
  let moved: { id: string; cancelledAt: string };
  try {
    moved = await moveBooking(serviceDb(), accountId, bookingId, {
      startsAt, endsAt, meetingUrl: meetingUrl ?? undefined,
      job: { note: f.note, placeId: f.placeId, meetingType: f.meetingType, holdUntil: holdUntilFrom(now),
        closureKept: check.warnings.some((w) => w.kind === "closed") },
    }, access.userId, "user");
  } catch (e) {
    if (e instanceof BookingNotMovableError) return changed;
    console.error(`${tag}: move failed: ${loggableError(e)}`);
    return saveFailed;
  }

  // Plan review item 2: decided only now, from the old row as the move left it (cancelled, so final).
  // T10 review I2: the tick is what the person chose against `told` AS THE FORM OPENED. Told nothing then (the
  // tick off because there was nobody to tell yet), and the old row's own email claimed since (its hold settled
  // with an email wanted, or one went): the customer now holds the OLD time, so they hear the new one, ticked or
  // not. Answering "changed" instead could not cover this: the move has already committed by the re-read, and only
  // the re-read is final (a settle can claim between any earlier check and the move's cancel).
  let wanted: NoticeWanted | null = null;
  try {
    const old = await readAgendaJob(serviceDb(), accountId, bookingId);
    const toldSinceOpened = !toldAtOpen && old !== null
      && (old.notice_sent_at !== null || (old.hold_settled_at !== null && old.notice_wanted !== null));
    wanted = old?.notice_wanted === "confirmation" && old.hold_settled_at === null ? "confirmation"
      : f.notify || toldSinceOpened ? "moved" : null;
  } catch (e) {
    console.error(`${tag}: moved to ${moved.id}, but the old row could not be re-read, so no email is asked for: ${loggableError(e)}`);
  }
  if (availability !== "available") wanted = null;
  let notice: "scheduled" | "none" = "none";
  if (wanted) {
    try {
      if (await setJobNotice(serviceDb(), accountId, moved.id, wanted)) notice = "scheduled";
      else console.error(`${tag}: moved to ${moved.id}, but its ${wanted} email could not be asked for (the hold settled first)`);
    } catch (e) {
      console.error(`${tag}: moved to ${moved.id}, but its ${wanted} email could not be asked for: ${loggableError(e)}`);
    }
  }
  const newId = moved.id;
  after(() => settleAfterWindow(accountId, newId, origin));
  revalidatePath(calendarPath(accountId));
  return { ok: true, mode: "moved", newId, oldId: bookingId, cancelledAt: moved.cancelledAt,
    startsAt: startsAt.toISOString(), first, notice };
}

/**
 * Spec 6.3: the Undo of an in-place edit writes the opened values back, compare-and-set on what the edit wrote.
 *
 * T10 review I1: `to` is only compared, so the compare-and-set pins it to the row; `from` is WRITTEN, and it is the
 * browser's word. So whatever `from` changes is proven first. A place it names that the row does not name now must
 * be this customer's or their household's (the add/edit rule, read on the request client; archived counts, since
 * the job may have named it). A link must be the one the row holds now, or none: the confirmation and the reminder
 * render it as the branded Join button, and nothing stored remembers a link an edit dropped (editJobDetails
 * overwrites meeting_url and writes no event), so the Undo of an edit that left video cannot put that link back
 * and answers "changed" rather than take a URL from the browser.
 */
export async function undoEditJobAction(
  accountId: string, bookingId: string, from: JobOpened, to: JobOpened,
): Promise<{ ok: true } | { ok: false; errorKey: "calendar.job.changed" }> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(bookingId)) return changed;
  const a = parseOpened(from);
  const b = parseOpened(to);
  if (!a || !b) return changed;
  if (a.meetingUrl !== null && a.meetingUrl !== b.meetingUrl) return changed;
  if (await proveBooking("undoEditJobAction", accountId, bookingId)) return changed;
  try {
    if (a.placeId !== null && a.placeId !== b.placeId) {
      const db = await dbForRequest();
      const row = await readAgendaJob(db, accountId, bookingId);
      if (!row || !(await placeIsCustomers(db, accountId, row.contact_id, a.placeId, true))) return changed;
    }
    if (!(await editJobDetails(serviceDb(), accountId, bookingId, detailsOf(b), detailsOf(a)))) return changed;
  } catch (e) {
    console.error(`undoEditJobAction: failed for booking ${bookingId} (account ${accountId}): ${loggableError(e)}`);
    return changed;
  }
  revalidatePath(calendarPath(accountId));
  return { ok: true };
}

/**
 * Spec 6.3 (D6): the Undo of a move, `undo_staff_move` with the move's own cancel stamp (it retries a deadlock
 * once, carry-in 3). BOTH rows are proven. It writes no event: the move wrote none (D8 extended). The restored
 * row is RE-ARMED (plan review item 2): its own hold may have fallen due while the move had it cancelled, when
 * nothing could claim it; one after() settle waits out what is left of it. Exactly one settler wins the claim, and
 * a row that settled before the move is never claimed again, so it is not re-armed.
 */
export async function undoMoveJobAction(
  accountId: string, newId: string, oldId: string, cancelledAt: string,
): Promise<UndoMoveResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(newId) || !isUuid(oldId) || !isIsoTime(cancelledAt)) return statusFailed;
  if (await proveBooking("undoMoveJobAction", accountId, newId)) return statusFailed;
  if (await proveBooking("undoMoveJobAction", accountId, oldId)) return statusFailed;
  const now = new Date();
  const tag = `undoMoveJobAction: ${newId} back to ${oldId} (account ${accountId})`;
  let old: AgendaBookingRow | null;
  let outcome;
  try {
    // Read before the undo: the restore writes only status and updated_at, and nothing claims a cancelled row.
    old = await readAgendaJob(await dbForRequest(), accountId, oldId);
    if (!old) return changed;
    outcome = await undoStaffMove(serviceDb(), accountId, newId, oldId, cancelledAt, now);
  } catch (e) {
    console.error(`${tag} failed: ${loggableError(e)}`);
    return statusFailed;
  }
  if (outcome === "time_taken") return { ok: false, errorKey: "calendar.job.moveUndoTaken" };
  if (outcome === "too_late") return { ok: false, errorKey: "calendar.job.undoTooLate" };
  if (outcome !== "undone") return changed;
  if (old.hold_until !== null && old.hold_settled_at === null) {
    const waitMs = Math.max(0, Date.parse(old.hold_until) - now.getTime()) + NOTICE_GRACE_MS;
    const origin = originFrom(await headers());
    after(() => settleAfterWindow(accountId, oldId, origin, { waitMs }));
  }
  revalidatePath(calendarPath(accountId));
  return { ok: true, startsAt: old.starts_at };
}

/** Spec 5.4: whether the Add job sheet may offer "Send {first} a confirmation" (`jobNoticeAvailability`: the contact
 *  read as the caller, so a contact they cannot see reads as no email; the two suppressions as the gate reads them). */
export async function jobNoticeOptionAction(
  accountId: string, contactId: string,
): Promise<{ ok: true; notice: NoticeAvailability } | { ok: false }> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(contactId)) return { ok: false };
  try {
    return { ok: true, notice: await jobNoticeAvailability(await dbForRequest(), serviceDb(), accountId, contactId.toLowerCase()) };
  } catch (e) {
    console.error(`jobNoticeOptionAction: failed for contact ${contactId} (account ${accountId}): ${loggableError(e)}`);
    return { ok: false };
  }
}
