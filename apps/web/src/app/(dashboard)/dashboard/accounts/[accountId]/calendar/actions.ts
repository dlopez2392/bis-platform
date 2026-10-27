"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import {
  serviceDb, updateCalendarSettings, getOrCreateCalendar, nextSpanishBox,
  setBookingStatus, undoOperatorCancel,
  discardQueuedNotice, noticeMessageStatus, savePendingCancelNotice, deletePendingCancelNotice,
  setBookingClosureKept, bumpHeldForAccount, emit,
  BookingNotStartedError, BookingNotRestorableError, SlotTakenError,
  type BookingStatus, type CalendarSettingsPatch,
} from "@bis/db";
import { requireAccountAccess, requireAccountOwner } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { callerCanSee, noticeBelongsToBooking } from "@/lib/auth/visible";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { DEFAULT_FOLLOWUP_BODY, defaultFollowupBody } from "@/lib/email/templates/followup";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { originFrom } from "@/lib/email/origin";
import { isValidEmail } from "@/lib/forms/guards";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { HOURS_FORM_DAYS, rowsToOpenHours, type HoursRow } from "./hours-form";
import { parseNotifyEmails } from "./notify-emails";
import {
  cancelNoticeAvailability, queueCancelNotice, sendQueuedCancelNotice, type NoticeAvailability,
} from "./cancel-notice";
import { NOTICE_MESSAGE_MAX, UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** F-048: what the Cancel dialog asks for. `locale` and `message` are
 *  re-checked here: a server action is an endpoint like any other. */
export type CancelNoticeChoice = { send: boolean; locale: string; message: string };

/** F-048: `version` is the cancel's own, which the Undo hands back.
 *  `notice` says what the toast may tell the owner: "scheduled" (the
 *  customer is emailed when the Undo window closes; `noticeMessageId` is its
 *  queued thread row), "address_blocked" (their address cannot receive email)
 *  or "none" (nobody was told). */
export type CancelBookingResult =
  | { ok: true; version: string; notice: "scheduled"; noticeMessageId: string }
  | { ok: true; version: string; notice: "none" | "address_blocked" }
  | { ok: false; error: string };

export type CancelNoticeOptionResult =
  | { ok: true; notice: NoticeAvailability }
  | { ok: false; error: string };

type MeetingType = NonNullable<CalendarSettingsPatch["meetingType"]>;
const MEETING_TYPES: readonly MeetingType[] = ["in_person", "phone", "video"];
function isMeetingType(v: FormDataEntryValue | null): v is MeetingType {
  return typeof v === "string" && (MEETING_TYPES as readonly string[]).includes(v);
}

/**
 * Task 7 (staff and roles, spec §7-§9): calendar SETTINGS are Owner-only —
 * `requireAccountOwner` admits the agency and a client Owner, and redirects
 * Staff (and a client whose role could not be settled) to their own
 * dashboard before this function body ever runs. The booking actions below
 * (cancel, mark no-show, etc.) are client business-as-usual, same class of
 * surface as contacts (spec §8), so THEY stay on the shared
 * `requireAccountAccess`, which still admits Staff.
 *
 * dbForRequest(), never serviceDb(): `booking-grants.test.ts` pins the exact
 * column list `authenticated` may UPDATE on `calendars` (the settings
 * columns, and nothing on `public_id`/`account_id`/`id`) — that grant list
 * IS the boundary a client operator writes inside. Routing this through
 * serviceDb() would bypass it and leave this guard as the only thing
 * standing behind the write, the mistake the M4d sendingAddress lesson
 * already cost a page. Migration 0066 also RESTRICTIVEs this UPDATE to
 * owners at the database layer; the catch below already answers the generic
 * `saveFailed` message for ANY write failure (never echoing `updateCalendarSettings`'s
 * own "no calendar for <id>" wording), so even if that restrictive policy
 * were ever the only thing standing between a Staff caller and this write,
 * the caller would see a refusal, not "calendar missing".
 */
export async function updateCalendarSettingsAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId } = await requireAccountOwner(accountId);

  const slotDurationMinutes = Number(formData.get("slotDurationMinutes"));
  const bufferMinutes = Number(formData.get("bufferMinutes"));
  const minNoticeHours = Number(formData.get("minNoticeHours"));
  const maxAdvanceDays = Number(formData.get("maxAdvanceDays"));
  if (![slotDurationMinutes, bufferMinutes, minNoticeHours, maxAdvanceDays].every(Number.isFinite)) {
    return { ok: false, error: m["calendar.settings.saveFailed"] };
  }

  const meetingTypeRaw = formData.get("meetingType");
  if (!isMeetingType(meetingTypeRaw)) {
    return { ok: false, error: m["calendar.settings.saveFailed"] };
  }
  const meetingType = meetingTypeRaw;

  const rows: HoursRow[] = HOURS_FORM_DAYS.map((day) => ({
    day,
    from: String(formData.get(`hours_${day}_from`) ?? ""),
    to: String(formData.get(`hours_${day}_to`) ?? ""),
  }));

  // D-034: every address is checked, and the whole save is refused on the
  // first bad one, naming it (`setReportEmailsAction`'s shape). Dropping it
  // and saving the rest would read as "saved" while quietly losing a
  // recipient. A returned error, never a throw: Next redacts a thrown
  // message in production.
  const notifyEmails = parseNotifyEmails(String(formData.get("notifyEmails") ?? ""));
  for (const email of notifyEmails) {
    if (!isValidEmail(email)) {
      return { ok: false, error: m["calendar.settings.notifyEmailsInvalid"].replace("{value}", email) };
    }
  }

  // Server-side belt for the UI's seeding fix: the textarea is seeded with
  // the stored value only (never the default), but this normalizes the
  // submission too, in case a body that happens to equal the default text
  // arrives some other way (e.g. the operator typing it verbatim, or a
  // future caller of this action that isn't the current form). A stored
  // copy identical to `DEFAULT_FOLLOWUP_BODY` adds nothing over an empty
  // column and would go stale the moment the default's own copy changes —
  // so it's collapsed back to "", keeping "empty column" the single source
  // of truth for "use the live default at send time".
  const followupBodyRaw = String(formData.get("followupBody") ?? "");
  const followupBody = followupBodyRaw.trim() === DEFAULT_FOLLOWUP_BODY ? "" : followupBodyRaw;
  // Task 17, plan deviation 6: neither language had a length check before
  // this task. Both are bounded here, the submitted English BEFORE it is
  // compared against anything else below. UNTRIMMED, the automations/voice
  // convention (`voice/actions.ts`'s `textbackBody.length`,
  // `automations/actions.ts`'s `body.length`) — trimming first would let
  // 1,001 spaces (trim-empty) sail past the bound and land in the column.
  if (followupBody.length > AUTOMATION_BODY_MAX_LENGTH) {
    return { ok: false, error: m["automations.bodyTooLong"] };
  }
  const submittedEs = String(formData.get("body_es") ?? "");
  if (submittedEs.length > AUTOMATION_BODY_MAX_LENGTH) {
    return { ok: false, error: m["automations.bodyTooLong"] };
  }

  const db = await dbForRequest();
  try {
    // Task 17: the request client, never serviceDb() — this write is
    // client-role (0022:12-13), and 0076 granted the two Spanish columns to
    // the same grant list `booking-grants.test.ts` pins.
    const current = await getOrCreateCalendar(db, accountId, userId);
    const es = nextSpanishBox({
      submitted: submittedEs,
      useOurs: formData.get("body_es_use_ours") === "1",
      stillMatches: formData.get("body_es_still_matches") === "on",
      defaultEs: defaultFollowupBody("es"),
      body: followupBody,
      stored: { bodyEs: current.followup_body_es, basis: current.followup_body_es_basis },
    });
    await updateCalendarSettings(db, accountId, {
      enabled: formData.get("enabled") === "on",
      slotDurationMinutes,
      bufferMinutes,
      minNoticeHours,
      maxAdvanceDays,
      openHours: rowsToOpenHours(rows),
      notifyEmails,
      meetingType,
      followupEnabled: formData.get("followupEnabled") === "on",
      followupBody,
      followupBodyEs: es.bodyEs,
      followupBodyEsBasis: es.basis,
    }, userId);
  } catch (e) {
    console.error(`updateCalendarSettingsAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["calendar.settings.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}

/**
 * F-085 part 1, spec §7.3: "prove the target through the request client, then
 * write through the service client". Every booking action below writes (or
 * reads) with serviceDb(), which RLS does not bind, so each first proves the
 * booking with `callerCanSee`, through the caller's OWN client: under 0068 a
 * Technician cannot see another person's customer's booking, and the proof
 * fails with no role branching here. A "no" and a proof that could not be
 * made are the same generic refusal; `action` names the caller in the log.
 * Answers null when the booking is proven.
 */
async function proveBooking(
  action: string, accountId: string, bookingId: string,
): Promise<{ ok: false; error: string } | null> {
  try {
    if (await callerCanSee("bookings", accountId, bookingId)) return null;
  } catch (e) {
    console.error(`${action}: booking ${bookingId} could not be proven (account ${accountId}): ${String(e)}`);
  }
  return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
}

/**
 * Cancel / complete / no-show, both audiences.
 *
 * Deliberately serviceDb(), the one exception in this file: unlike the
 * settings columns above, `booking-grants.test.ts` grants `authenticated`
 * NO UPDATE at all on `bookings` — not one column, for either audience — on
 * purpose, so the column grant that would make dbForRequest() safe here does
 * not exist. What stands behind this write instead is two checks:
 * `requireAccountAccess` (the caller works in this account) and then
 * `proveBooking` → `callerCanSee` (spec §7.3: the caller's own client, RLS and
 * 0068 included, can see THIS booking). The second is the boundary a
 * Technician meets. `setBookingStatus` itself still scopes the update to
 * `.eq("account_id", accountId)`.
 */
export async function setBookingStatusAction(
  accountId: string, bookingId: string, status: BookingStatus,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const refused = await proveBooking("setBookingStatusAction", accountId, bookingId);
  if (refused) return refused;

  // D-036: the way back to "booked" is `undoCancelBookingAction` below and
  // only that, because only it carries the un-cancel guard (`onlyFrom`).
  // Through here a crafted request could reopen a COMPLETED job.
  if (status === "booked") return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };

  try {
    // D-030: `startedBy` is the server's own clock, never the page's. An
    // outcome (completed / no_show) on an appointment that has not started is
    // refused by the write itself — the button is hidden too, but a stale page
    // or a crafted request reaches this action all the same, and so does the
    // To do screen's close-out, which calls it.
    // D-036 review: a Cancel writes only a row that is still "booked", so a
    // stale tab cannot cancel a job already marked completed (whose Undo,
    // an un-cancel only, could then never reopen it). Outcomes are not
    // limited: completed and no-show stay correctable into each other.
    await setBookingStatus(serviceDb(), accountId, bookingId, status, userId, "user", {
      startedBy: new Date().toISOString(),
      ...(status === "cancelled" ? { onlyFrom: "booked" as const } : {}),
    });
  } catch (e) {
    if (e instanceof BookingNotStartedError) {
      return { ok: false, error: m["calendar.bookings.notStartedYet"] };
    }
    console.error(`setBookingStatusAction: ${status} failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}

/**
 * F-048: before the Calendar page opens its Cancel dialog, can a customer
 * notice go at all? (`cancelNoticeAvailability`: an address, an account that
 * sends, an address that has not hard-bounced or complained.) Only
 * "available" opens the dialog; anything else cancels at once with the
 * matching toast, so the dialog is never a bare "Are you sure?" (rule 6).
 * A read that fails answers `{ ok: false }`; its `error` string is shown
 * nowhere: `runCancelButton` treats any failure as "no notice" and cancels
 * at once with the we-haven't-told-them toast.
 */
export async function cancelNoticeOptionAction(
  accountId: string, bookingId: string,
): Promise<CancelNoticeOptionResult> {
  // M7a PR-4 (plan G11): a read, so it stays usable while the account is paused (the cancel is refused).
  await requireAccountAccess(accountId, { duringPause: "allow" });
  // The suppression facts are read with serviceDb(): prove the booking first.
  const refused = await proveBooking("cancelNoticeOptionAction", accountId, bookingId);
  if (refused) return refused;
  try {
    return { ok: true, notice: await cancelNoticeAvailability(await dbForRequest(), serviceDb(), accountId, bookingId) };
  } catch (e) {
    console.error(`cancelNoticeOptionAction: failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }
}

/**
 * F-048: the Calendar page's Cancel. It cancels AT ONCE (a row that is still
 * booked only, D-036's review) and answers the cancel's version, which the
 * Undo hands back.
 *
 * When the owner asked for the customer notice, whether it can go is checked
 * BEFORE the cancel; a read that fails cancels WITHOUT the notice (fail open
 * to the reversible action) and answers "none", so the toast never promises
 * an email nobody could check. When it can, the email is
 * composed and its thread row written QUEUED in this request, then the send
 * is scheduled with `after()` to run once the Undo window has closed
 * (`cancel-notice.ts`), never inside this response, which is what keeps the
 * cancel reversible (DESIGN.md rule 6). Beside it goes the notice's durable
 * copy (`savePendingCancelNotice`, 0100), which the cron sweep sends from if
 * this process dies first; a copy that cannot be written is logged and the
 * notice goes on through `after()` alone. A notice that cannot be queued after
 * the cancel committed is not promised: the toast says the customer was not
 * told.
 *
 * serviceDb() for the writes, behind `proveBooking` → `callerCanSee` (spec
 * §7.3: the booking proven through the caller's own client first, as
 * `setBookingStatusAction` explains); the contact is read as the signed-in
 * user (RLS).
 */
export async function cancelBookingAction(
  accountId: string, bookingId: string, notice: CancelNoticeChoice,
): Promise<CancelBookingResult> {
  const { userId } = await requireAccountAccess(accountId);
  const refused = await proveBooking("cancelBookingAction", accountId, bookingId);
  if (refused) return refused;

  const message = String(notice?.message ?? "").replace(/\r\n/g, "\n").trim();
  if (message.length > NOTICE_MESSAGE_MAX) return { ok: false, error: m["calendar.cancelDialog.messageTooLong"] };
  const locale = normalizeLocale(typeof notice?.locale === "string" ? notice.locale : undefined, "en");

  let availability: NoticeAvailability | null = null;
  if (notice?.send === true) {
    try {
      availability = await cancelNoticeAvailability(await dbForRequest(), serviceDb(), accountId, bookingId);
    } catch (e) {
      // Fix round 2 (M-a): fail OPEN to the reversible action. The cancel
      // goes ahead WITHOUT the notice, and `notice: "none"` makes the toast
      // say the customer was not told; a broken read must never stop the
      // owner cancelling, nor promise an email nobody could check.
      console.error(`cancelBookingAction: notice check failed for booking ${bookingId} (account ${accountId}), cancelling without it: ${String(e)}`);
      availability = null;
    }
  }

  let version: string;
  try {
    ({ updatedAt: version } = await setBookingStatus(
      serviceDb(), accountId, bookingId, "cancelled", userId, "user", { onlyFrom: "booked" },
    ));
  } catch (e) {
    console.error(`cancelBookingAction: cancel failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }

  let result: CancelBookingResult = {
    ok: true, version, notice: availability === "address_blocked" ? "address_blocked" : "none",
  };
  if (availability === "available") {
    try {
      const origin = originFrom(await headers());
      const queued = await queueCancelNotice(serviceDb(), { accountId, bookingId, userId, locale, message, origin });
      // The notice's durable copy (0100): the cron sweep sends it if this
      // process dies before after() does. Its own try: a copy that cannot be
      // written leaves the notice exactly as it was before the sweep existed,
      // promised and sent by after().
      try {
        await savePendingCancelNotice(serviceDb(), {
          accountId, bookingId, version, messageId: queued.messageId, userId, email: queued.email,
          dueAt: new Date(Date.now() + UNDO_WINDOW_MS + NOTICE_GRACE_MS).toISOString(),
        });
      } catch (e) {
        console.error(`cancelBookingAction: notice for booking ${bookingId} (account ${accountId}) queued but not durable: ${String(e)}`);
      }
      after(async () => {
        const outcome = await sendQueuedCancelNotice({ accountId, bookingId, version, userId, queued });
        if (outcome === "failed") {
          console.error(`cancelBookingAction: notice for booking ${bookingId} (account ${accountId}) not sent`);
        }
      });
      result = { ok: true, version, notice: "scheduled", noticeMessageId: queued.messageId };
    } catch (e) {
      console.error(`cancelBookingAction: notice for booking ${bookingId} (account ${accountId}) could not be queued: ${String(e)}`);
    }
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return result;
}

/**
 * S-47d Task 8: "Keep" on one appointment the closure card lists as affected — it still happens, so its
 * reminders and follow-up go out as usual (`closures.ts`'s `closureVerdict` reads `closure_kept_at`
 * before it reads the closure at all, SD20). `seesWholeAccount` admits the agency, an Owner or Staff —
 * the same audience as the booking actions above; a Technician is refused. The write is still proven
 * through the caller's own client first (spec §7.3, `proveBooking`, as every booking action in this
 * file does), then runs on serviceDb() (bookings carry no client-role UPDATE grant at all, 0022).
 */
export async function keepAppointmentAction(
  accountId: string, bookingId: string, kept: boolean, locale: "en" | "es",
): Promise<ActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return { ok: false, error: t(m, "business.refuse.keep", locale) };
  const refused = await proveBooking("keepAppointmentAction", accountId, bookingId);
  if (refused) return refused;

  let changed: boolean;
  try {
    changed = await setBookingClosureKept(serviceDb(), accountId, bookingId, kept);
  } catch (e) {
    console.error(`keepAppointmentAction: write failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: t(m, "business.card.keepFailed", locale) };
  }
  if (!changed) return { ok: false, error: t(m, "business.card.keepFailed", locale) };

  try {
    const db = await dbForRequest();
    await emit(db, accountId, "booking.closure_kept", access.userId, { booking_id: bookingId, kept }, "user");
  } catch (e) {
    console.error(`keepAppointmentAction: event emit failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
  }

  try {
    await bumpHeldForAccount(serviceDb(), accountId);
  } catch (e) {
    console.error(`keepAppointmentAction: bump failed for account ${accountId}: ${String(e)}`);
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}

/**
 * D-036: the Calendar page's Undo for a Cancel. DESIGN.md rule 6: a
 * reversible action runs at once and offers Undo; typing a name is for
 * destructive deletes, and an "Are you sure?" before it is the reflexive
 * dialog the rule forbids. Cancel here IS reversible: until the F-048 notice
 * goes (after the Undo window) it tells nobody, so putting the row back
 * undoes all of it.
 *
 * `version` (F-048, required) is the cancel's own: the Undo writes only while
 * the row still carries it, so it can never land after the notice claimed
 * the cancel. `noticeMessageId` is that notice's queued thread row: a winning
 * Undo removes it (nothing was sent). A refusal as `superseded` is told from
 * that row, truthfully: emailed, not emailed, or not known yet.
 *
 * `undoOperatorCancel` (packages/db) carries the other guards: an un-cancel
 * only, only of a cancel a PERSON made on the dashboard, and never of a
 * booking a reschedule has replaced; a time someone booked in between is
 * `SlotTakenError`.
 *
 * serviceDb() for the writes, behind `proveBooking` → `callerCanSee` (spec
 * §7.3, as `setBookingStatusAction` explains). The notice id is the browser's
 * word, and `discardQueuedNotice` / `noticeMessageStatus` act on it with the
 * service client scoped only by account, so proving the booking does not prove
 * the message: it is used only when `noticeBelongsToBooking` (the caller's own
 * client) finds it on the proven booking's contact's thread. Otherwise, or
 * when that cannot be told, it is treated as absent: the Undo still runs,
 * nothing is discarded, and a superseded refusal says only "changed".
 */
export async function undoCancelBookingAction(
  accountId: string, bookingId: string, version: string, noticeMessageId?: string,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const refused = await proveBooking("undoCancelBookingAction", accountId, bookingId);
  if (refused) return refused;
  if (typeof version !== "string" || version === "") {
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }
  let messageId = typeof noticeMessageId === "string" && noticeMessageId !== "" ? noticeMessageId : null;
  if (messageId) {
    try {
      if (!(await noticeBelongsToBooking(accountId, bookingId, messageId))) messageId = null;
    } catch (e) {
      console.error(`undoCancelBookingAction: notice ${messageId} could not be bound to booking ${bookingId} (account ${accountId}), ignoring it: ${String(e)}`);
      messageId = null;
    }
  }

  try {
    await undoOperatorCancel(serviceDb(), accountId, bookingId, userId, version);
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return { ok: false, error: m["calendar.bookings.restoreSlotTaken"] };
    }
    if (e instanceof BookingNotRestorableError) {
      if (e.reason === "superseded") return { ok: false, error: await supersededWords(accountId, messageId) };
      return {
        ok: false,
        error: e.reason === "rescheduled" ? m["calendar.bookings.restoreRescheduled"] : m["calendar.bookings.restoreNotOurs"],
      };
    }
    console.error(`undoCancelBookingAction: failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }

  // Best effort, by THIS cancel's version: a pending row left behind is found
  // by the sweep, which loses the claim, reads the booking booked, and removes
  // it with the queued row.
  try {
    await deletePendingCancelNotice(serviceDb(), accountId, bookingId, version);
  } catch (e) {
    console.error(`undoCancelBookingAction: booking ${bookingId} restored, its pending notice not removed: ${String(e)}`);
  }

  if (messageId) {
    // Best effort: the notice's own job also removes it when its claim loses.
    try {
      await discardQueuedNotice(serviceDb(), accountId, messageId);
    } catch (e) {
      console.error(`undoCancelBookingAction: booking ${bookingId} restored, its queued notice not removed: ${String(e)}`);
    }
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}

/** What the owner is told when the Undo lost to a newer write: whether the
 *  customer was actually emailed is read off the notice's own row, never
 *  assumed. An unreadable row is "not known", never "emailed". */
async function supersededWords(accountId: string, messageId: string | null): Promise<string> {
  if (!messageId) return m["calendar.bookings.restoreChanged"];
  let status: string | null;
  try {
    status = await noticeMessageStatus(serviceDb(), accountId, messageId);
  } catch (e) {
    console.error(`undoCancelBookingAction: notice row unreadable for account ${accountId}: ${String(e)}`);
    status = "queued";
  }
  if (status === "sent" || status === "delivered" || status === "opened") return m["calendar.bookings.restoreCustomerTold"];
  if (status === "failed" || status === "bounced") return m["calendar.bookings.restoreNoticeFailed"];
  if (status === "queued") return m["calendar.bookings.restoreNoticeUnknown"];
  return m["calendar.bookings.restoreChanged"];
}
