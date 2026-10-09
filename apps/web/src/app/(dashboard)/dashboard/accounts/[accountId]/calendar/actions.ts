"use server";

import { revalidatePath } from "next/cache";
import {
  serviceDb, updateCalendarSettings, setBookingStatus, BookingNotStartedError, SlotTakenError,
  type BookingStatus, type CalendarSettingsPatch,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { DEFAULT_FOLLOWUP_BODY } from "@/lib/email/templates/followup";
import { isValidEmail } from "@/lib/forms/guards";
import { HOURS_FORM_DAYS, rowsToOpenHours, type HoursRow } from "./hours-form";
import { parseNotifyEmails } from "./notify-emails";

export type ActionResult = { ok: true } | { ok: false; error: string };

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
    await setBookingStatus(serviceDb(), accountId, bookingId, status, userId, "user",
      { startedBy: new Date().toISOString() });
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
 * D-036: the Calendar page's Undo for a Cancel. DESIGN.md rule 6: a
 * reversible action runs at once and offers Undo; typing a name is for
 * destructive deletes, and an "Are you sure?" before it is the reflexive
 * dialog the rule forbids. Cancel here IS reversible: it tells nobody (no
 * customer email, no staff alert; `setBookingStatus` writes the row and one
 * `booking.status_changed` event, which only the activity feed reads), so
 * putting the row back undoes all of it.
 *
 * `onlyFrom: "cancelled"`: an un-cancel only, as a predicate on the write, so
 * a late click can never reopen a booking that has since become anything
 * else. The flip re-enters `bookings_no_overlap`; if a customer booked the
 * freed time in the meantime, the write refuses with `SlotTakenError` and the
 * operator is told so in words. serviceDb() for the reason
 * `setBookingStatusAction` gives above: no UPDATE grant on `bookings` exists
 * for `authenticated`, so `requireAccountAccess` is the gate.
 */
export async function undoCancelBookingAction(
  accountId: string, bookingId: string,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);

  try {
    await setBookingStatus(serviceDb(), accountId, bookingId, "booked", userId, "user",
      { onlyFrom: "cancelled" });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return { ok: false, error: m["calendar.bookings.restoreSlotTaken"] };
    }
    console.error(`undoCancelBookingAction: failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}
