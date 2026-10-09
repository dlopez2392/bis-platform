"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import {
  serviceDb, updateCalendarSettings, setBookingStatus, undoOperatorCancel,
  bookingContactEmail, isAccountOutboundSuppressed,
  BookingNotStartedError, BookingNotRestorableError, SlotTakenError,
  type BookingStatus, type CalendarSettingsPatch,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { DEFAULT_FOLLOWUP_BODY } from "@/lib/email/templates/followup";
import { originFrom } from "@/lib/email/origin";
import { isValidEmail } from "@/lib/forms/guards";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { HOURS_FORM_DAYS, rowsToOpenHours, type HoursRow } from "./hours-form";
import { parseNotifyEmails } from "./notify-emails";
import { sendCancelNoticeAfterUndo } from "./cancel-notice";
import { NOTICE_MESSAGE_MAX } from "./undo-window";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** F-048: what the Cancel dialog asks for. `locale` and `message` are
 *  re-checked here: a server action is an endpoint like any other. */
export type CancelNoticeChoice = { send: boolean; locale: string; message: string };

/** F-048: `version` is the cancel's own, which the Undo hands back;
 *  `noticeScheduled` says whether the customer will be emailed when the Undo
 *  window closes, so the toast tells the owner the truth either way. */
export type CancelBookingResult =
  | { ok: true; version: string; noticeScheduled: boolean }
  | { ok: false; error: string };

type MeetingType = NonNullable<CalendarSettingsPatch["meetingType"]>;
const MEETING_TYPES: readonly MeetingType[] = ["in_person", "phone", "video"];
function isMeetingType(v: FormDataEntryValue | null): v is MeetingType {
  return typeof v === "string" && (MEETING_TYPES as readonly string[]).includes(v);
}

/**
 * Both audiences reach this — calendar is the client's own business data,
 * same class of surface as contacts (spec §8) — so the guard is the shared
 * `requireAccountAccess`, not the agency-only variant Settings itself uses.
 *
 * dbForRequest(), never serviceDb(): `booking-grants.test.ts` pins the exact
 * column list `authenticated` may UPDATE on `calendars` (the settings
 * columns, and nothing on `public_id`/`account_id`/`id`) — that grant list
 * IS the boundary a client operator writes inside. Routing this through
 * serviceDb() would bypass it and leave this guard as the only thing
 * standing behind the write, the mistake the M4d sendingAddress lesson
 * already cost a page.
 */
export async function updateCalendarSettingsAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);

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

  try {
    await updateCalendarSettings(await dbForRequest(), accountId, {
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
    }, userId);
  } catch (e) {
    console.error(`updateCalendarSettingsAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["calendar.settings.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}

/**
 * Cancel / complete / no-show, both audiences.
 *
 * Deliberately serviceDb(), the one exception in this file: unlike the
 * settings columns above, `booking-grants.test.ts` grants `authenticated`
 * NO UPDATE at all on `bookings` — not one column, for either audience. A
 * client-role UPDATE on this table has no legitimate caller outside this
 * action (operators change status here; the public cancel-by-token flow
 * writes through serviceDb too), so `requireAccountAccess` above is the
 * ONLY thing standing behind this write — same shape as `setClientAccessAction`
 * in settings/actions.ts, and for the same reason: the column grant that
 * would make dbForRequest() safe here does not exist, on purpose.
 * `setBookingStatus` itself still scopes the update to `.eq("account_id",
 * accountId)`, so this can only ever touch the caller's own account's rows.
 */
export async function setBookingStatusAction(
  accountId: string, bookingId: string, status: BookingStatus,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);

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
 * F-048: the Calendar page's Cancel, from its dialog. It cancels AT ONCE (a
 * row that is still booked only, D-036's review) and answers the cancel's
 * version, which the Undo hands back. When the owner asked for the customer
 * notice and it can go (the contact has an address, the account is not
 * marked not to send), the notice is scheduled with `after()` to run once
 * the Undo window has closed (`cancel-notice.ts`): never inside this
 * response, which is what keeps the cancel reversible (DESIGN.md rule 6).
 *
 * Both checks run BEFORE the cancel, and a read that fails refuses the whole
 * thing: the toast must never say "we'll email the customer" for a notice
 * nobody could check. serviceDb() for the write, for the reason
 * `setBookingStatusAction` gives below; the address is read as the signed-in
 * user (RLS), and the suppression flag the way the composer reads it.
 */
export async function cancelBookingAction(
  accountId: string, bookingId: string, notice: CancelNoticeChoice,
): Promise<CancelBookingResult> {
  const { userId } = await requireAccountAccess(accountId);

  const message = String(notice?.message ?? "").replace(/\r\n/g, "\n").trim();
  if (message.length > NOTICE_MESSAGE_MAX) return { ok: false, error: m["calendar.cancelDialog.messageTooLong"] };
  const locale = normalizeLocale(typeof notice?.locale === "string" ? notice.locale : undefined, "en");

  let noticeScheduled = false;
  if (notice?.send === true) {
    try {
      const to = await bookingContactEmail(await dbForRequest(), accountId, bookingId);
      noticeScheduled = to !== null && !(await isAccountOutboundSuppressed(serviceDb(), accountId));
    } catch (e) {
      console.error(`cancelBookingAction: notice check failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
      return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
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

  if (noticeScheduled) {
    const origin = originFrom(await headers());
    after(async () => {
      const outcome = await sendCancelNoticeAfterUndo({ accountId, bookingId, version, userId, locale, message, origin });
      if (outcome !== "sent" && outcome !== "undone") {
        console.error(`cancelBookingAction: notice for booking ${bookingId} (account ${accountId}) not sent: ${outcome}`);
      }
    });
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true, version, noticeScheduled };
}

/**
 * D-036: the Calendar page's Undo for a Cancel. DESIGN.md rule 6: a
 * reversible action runs at once and offers Undo; typing a name is for
 * destructive deletes, and an "Are you sure?" before it is the reflexive
 * dialog the rule forbids. Cancel here IS reversible: until the F-048 notice
 * goes (after the Undo window) it tells nobody (no staff alert;
 * `setBookingStatus` writes the row and one `booking.status_changed` event,
 * which only the activity feed reads), so putting the row back undoes all of
 * it. `version` (F-048) is the cancel's own: the Undo writes only while the
 * row still carries it, so it can never land after the notice claimed the
 * cancel (`customer_told`).
 *
 * `undoOperatorCancel` (packages/db) carries the guards: an un-cancel only
 * (`onlyFrom: "cancelled"` on the write), only of a cancel a PERSON made on
 * the dashboard (never the customer's link or Sofía's call), and never of a
 * booking a reschedule has replaced. The flip re-enters
 * `bookings_no_overlap`; if a customer booked the freed time in the
 * meantime, it refuses with `SlotTakenError`. Each refusal is told in words. serviceDb() for the reason
 * `setBookingStatusAction` gives above: no UPDATE grant on `bookings` exists
 * for `authenticated`, so `requireAccountAccess` is the gate.
 */
export async function undoCancelBookingAction(
  accountId: string, bookingId: string, version?: string,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);

  try {
    await undoOperatorCancel(serviceDb(), accountId, bookingId, userId,
      { version: typeof version === "string" ? version : undefined });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return { ok: false, error: m["calendar.bookings.restoreSlotTaken"] };
    }
    if (e instanceof BookingNotRestorableError) {
      return {
        ok: false,
        error: e.reason === "rescheduled" ? m["calendar.bookings.restoreRescheduled"]
          : e.reason === "customer_told" ? m["calendar.bookings.restoreCustomerTold"]
          : m["calendar.bookings.restoreNotOurs"],
      };
    }
    console.error(`undoCancelBookingAction: failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}
