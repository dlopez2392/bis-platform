import type { BookingMeetingType, BookingStatus, NoticeWanted } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { agendaTime } from "@/lib/booking/agenda-window";
import { partsInZone } from "@/lib/booking/slots";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";
import type { ActionResult } from "./actions";
import type { JobOpened, UndoAddResult } from "./agenda-actions";
import type { OpenedSnapshot } from "./job-sheet-handlers";

/**
 * F-046 part 1 (plan Task 11, spec 5.5, 6.4): what the job drawer's buttons DO, minus React, so the one rule
 * that matters most is tested without a DOM: Cancel on an ADD still inside its Undo hold is the add's Undo
 * (D7), so a customer who never heard of the job is never sent a "cancelled" notice about it. Client code: only
 * TYPES from the "use server" files; the drawer passes the actions in.
 */

type Toast = { success: (message: string) => unknown; error: (message: string) => unknown };
export type DrawerCancelView = { id: string; holdOpen: boolean; isMove: boolean; customer: { first: string } };

const firstOr = (first: string, locale: Locale) => first.trim() || t(m, "calendar.job.customerFallback", locale);

/**
 * The drawer's Cancel.
 * - An ADD inside its hold (`holdOpen && !isMove`): the add's Undo deletes it; nobody was told, so nobody is.
 *   When the Undo answers `fallback` (the hold settled first, so the confirmation went; or the row is a move's),
 *   the ordinary cancel runs instead.
 * - A held MOVE goes straight to the ordinary cancel (plan review item 3): Cancel means "this job is off", and
 *   undoing the move would bring back a time nobody asked for. The cancelled new row is never claimed (claims
 *   take booked rows only), so its "moved" email never goes; the cancel action itself decides whom to tell.
 * - Anything else: the ordinary cancel (cancel-flow.ts's `runCancelButton`, with its notice dialog and Undo).
 */
export async function cancelFromDrawer(d: {
  accountId: string; view: DrawerCancelView; locale: Locale; toast: Toast;
  undoAdd: (accountId: string, bookingId: string) => Promise<UndoAddResult>;
  ordinary: () => Promise<void>;
}): Promise<"undone" | "ordinary" | "refused"> {
  const { view, locale } = d;
  if (!view.holdOpen || view.isMove) {
    await d.ordinary();
    return "ordinary";
  }
  let r: UndoAddResult;
  try {
    r = await d.undoAdd(d.accountId, view.id);
  } catch {
    d.toast.error(t(m, "common.actionCrashed", locale));
    return "refused";
  }
  const first = firstOr(view.customer.first, locale);
  if (r.ok) {
    d.toast.success(t(m, "calendar.job.undone", locale, { first }));
    return "undone";
  }
  if (r.fallback) {
    await d.ordinary();
    return "ordinary";
  }
  d.toast.error(t(m, r.errorKey, locale, { first }));
  return "refused";
}

/** Mark completed / No-show (D-030): `setBookingStatusAction`, which the server refuses before the start. */
export async function closeOut(d: {
  accountId: string; bookingId: string; status: "completed" | "no_show"; locale: Locale; toast: Toast;
  setStatus: (accountId: string, bookingId: string, status: BookingStatus) => Promise<ActionResult>;
}): Promise<boolean> {
  let r: ActionResult;
  try {
    r = await d.setStatus(d.accountId, d.bookingId, d.status);
  } catch {
    d.toast.error(t(m, "common.actionCrashed", d.locale));
    return false;
  }
  if (r.ok) d.toast.success(t(m, "calendar.bookings.statusUpdated", d.locale));
  else d.toast.error(r.error);
  return r.ok;
}

/**
 * Which of the drawer's equal ghost buttons show (spec 5.5, 8.1; DESIGN.md rule 8, 2026-10-30: no primary).
 * Move and Cancel for whoever may write (never a Technician); the outcomes once the job has started, for
 * whoever may close it out (a Technician too, owner decision 1). Only a booked job has any.
 */
export function drawerActions(v: { status: BookingStatus; canWrite: boolean; canCloseOut: boolean; started: boolean }): {
  move: boolean; cancel: boolean; closeOut: boolean;
} {
  const booked = v.status === "booked";
  return { move: booked && v.canWrite, cancel: booked && v.canWrite, closeOut: booked && v.canCloseOut && v.started };
}

export type JobEmailState = { state: "sent" | "pending" | "failed" | "none"; kind: NoticeWanted | null; at: string | null };

/** The email line: the confirmation's trio, or the moved trio when the email is a move's new time. */
export function emailLine(e: JobEmailState, timezone: string, locale: Locale): string | null {
  if (e.state === "none") return null;
  const moved = e.kind === "moved";
  if (e.state === "sent") {
    const time = e.at ? agendaTime(new Date(e.at), timezone, locale, false) : "";
    return t(m, moved ? "calendar.job.movedEmailSent" : "calendar.job.emailSent", locale, { time });
  }
  if (e.state === "pending") return t(m, moved ? "calendar.job.movedEmailPending" : "calendar.job.emailPending", locale);
  return t(m, moved ? "calendar.job.movedEmailFailed" : "calendar.job.emailFailed", locale);
}

export function meetingWord(type: BookingMeetingType, locale: Locale): string {
  return t(m, type === "video" ? "calendar.job.byVideo" : type === "phone" ? "calendar.job.byPhone" : "calendar.job.inPerson", locale);
}

/**
 * A job's status as dot and word (DESIGN.md rule 3), from the automation history's own treatments so the two are
 * one system. Never `--warn` or `--crit`: spec 5.6 keeps those for the overlap and closed states.
 */
export const JOB_STATUS_TREATMENTS: Record<BookingStatus, { dot: string; chip: string }> = {
  booked: { dot: STATUS_TREATMENTS.held.dot, chip: STATUS_TREATMENTS.held.chip },
  completed: { dot: STATUS_TREATMENTS.sent.dot, chip: STATUS_TREATMENTS.sent.chip },
  cancelled: { dot: STATUS_TREATMENTS.skipped.dot, chip: STATUS_TREATMENTS.skipped.chip },
  no_show: { dot: "bg-muted-foreground", chip: "border-border bg-transparent text-foreground" },
};

const pad = (n: number) => String(n).padStart(2, "0");

/** What Move opens with (spec 5.4): the job's own day and start in the ACCOUNT's zone, its length and details,
 *  and "Email {first} the new time" ticked only when the customer knows this job (`told`, item 7). */
export function movePrefill(
  v: { customer: { id: string; name: string; first: string }; what: string | null; meetingType: BookingMeetingType;
    opened: { startsAt: string; endsAt: string; placeId: string | null }; told: boolean },
  timezone: string,
): { date: string; start: string; minutes: number; customer: { id: string; name: string; first: string }; what: string;
  placeId: string | null; meetingType: BookingMeetingType; notify: boolean } {
  const startsAt = new Date(v.opened.startsAt);
  const p = partsInZone(startsAt, timezone);
  return {
    date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, start: `${pad(p.hh)}:${pad(p.mi)}`,
    minutes: Math.round((Date.parse(v.opened.endsAt) - startsAt.getTime()) / 60_000),
    customer: v.customer, what: v.what ?? "", placeId: v.opened.placeId, meetingType: v.meetingType, notify: v.told,
  };
}

/** The job Move works on: its id and what the form opened with, with `told` as the drawer showed it (T10 review I2). */
export function moveJob(v: { id: string; opened: JobOpened; told: boolean }): { id: string; opened: OpenedSnapshot } {
  return { id: v.id, opened: { ...v.opened, told: v.told } };
}

/** The drawer's `onCloseAutoFocus`: focus goes back to the job's own row (`id="booking-<id>"`, spec 5.5). A row
 *  not on this page (a deep link to another day) is simply not focused. */
export function focusJobRow(
  event: { preventDefault(): void }, id: string,
  doc: { getElementById(id: string): { focus(): void } | null } = document,
): void {
  event.preventDefault();
  doc.getElementById(`booking-${id}`)?.focus();
}
