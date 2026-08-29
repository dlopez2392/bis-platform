"use server";

import { revalidatePath } from "next/cache";
import {
  serviceDb, updateCalendarSettings, setBookingStatus,
  type BookingStatus, type CalendarSettingsPatch,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { HOURS_FORM_DAYS, rowsToOpenHours, type HoursRow } from "./hours-form";

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

  const notifyEmails = String(formData.get("notifyEmails") ?? "")
    .split("\n").map((s) => s.trim()).filter(Boolean);

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
      followupBody: String(formData.get("followupBody") ?? ""),
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

  try {
    await setBookingStatus(serviceDb(), accountId, bookingId, status, userId);
  } catch (e) {
    console.error(`setBookingStatusAction: ${status} failed for booking ${bookingId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true };
}
