/**
 * F-046 part 1 (plan Task 12, spec 5.2-5.3): the agenda's view model. Pure: every instant is a parameter
 * (`now` is the page's one `nowIso`, never read here), and every word is made here, server-side, so the
 * client lists only lay it out. A row is on every day its range touches ([) bounds); a cancelled row is
 * muted and out of the lanes, a row a move replaced is not shown at all, and Week shows no cancelled rows
 * (D11); free rows are Day's only, and only for those who may add.
 */
import type { AgendaBookingRow, AuthorKind, BookingMeetingType, BookingStatus } from "@bis/db";
import type { MessageKey } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr, type Tr } from "@/lib/record/copy";
import { fitsOpenHours, partsInZone, type OpenHours } from "@/lib/booking/slots";
import { agendaLanes, type LaneItem } from "@/lib/booking/agenda-lanes";
import { agendaTime, freeHours, type AgendaDay, type AgendaView } from "@/lib/booking/agenda-window";
import { coversAppointment, type StatusInput } from "@/lib/business-status/status";
import { formatWhen } from "@/lib/booking/time";
import type { JobDrawerView } from "./job-drawer";
import type { JobEmailState } from "./job-drawer-handlers";

export type AgendaRowView = {
  id: string; href: string; startsAt: string; startLabel: string; endLabel: string; customer: string;
  what: string | null; address: string | null; meetingWord: string; statusWord: string; status: BookingStatus;
  live: boolean; overlaps: boolean; outsideHours: boolean; madeBy: string;
  confirmReply: "yes" | "no" | null; confirmWord: string | null;
};
/** `start` is the free hour's wall time ("HH:00"), the sheet's prefill; `at` its instant. */
export type AgendaFreeRow = { at: string; start: string; label: string };
export type AgendaDayView = {
  /** `short`: the week strip's and column head's "Sun 1"; `href`: that day's own Day. */
  key: string; heading: string; short: string; href: string; closed: string | null; rows: AgendaRowView[];
  lanes: LaneItem[]; cancelled: AgendaRowView[]; free: AgendaFreeRow[];
};

export function agendaHref(base: string, q: { view: AgendaView; day: string; job?: string | null }): string {
  return `${base}?view=${q.view}&day=${q.day}${q.job ? `&job=${encodeURIComponent(q.job)}` : ""}`;
}

const MEETING_KEY: Record<BookingMeetingType, MessageKey> = {
  in_person: "calendar.job.inPerson", phone: "calendar.job.byPhone", video: "calendar.job.byVideo",
};
const STATUS_KEY: Record<BookingStatus, MessageKey> = {
  booked: "calendar.bookings.status.booked", cancelled: "calendar.bookings.status.cancelled",
  completed: "calendar.bookings.status.completed", no_show: "calendar.bookings.status.no_show",
};
const CONFIRM_KEY: Record<"yes" | "no", MessageKey> = { yes: "calendar.bookings.confirmed", no: "calendar.bookings.confirmDeclined" };

export function meetingWord(tr: Tr, type: BookingMeetingType): string { return tr.text(MEETING_KEY[type]); }
export function statusWord(tr: Tr, status: BookingStatus): string { return tr.text(STATUS_KEY[status]); }

/** The author mark's words for a booking (spec 5.2; `lib/record/author-mark.ts`'s precedent, "Sofía" when no persona). */
export function madeByWords(tr: Tr, kind: AuthorKind, authorId: string | null,
  ctx: { viewerId: string | null; names: Readonly<Record<string, string>>; persona: string | null }): string {
  switch (kind) {
    case "person": {
      if (authorId && ctx.viewerId && authorId === ctx.viewerId) return tr.text("calendar.agenda.addedByYou");
      const named = authorId && Object.hasOwn(ctx.names, authorId) ? ctx.names[authorId] : undefined;
      return tr.text("calendar.agenda.addedBy", { name: named || tr.text("assign.someone") });
    }
    case "ai": return tr.text("calendar.agenda.bookedBy", { persona: ctx.persona?.trim() || "Sofía" });
    case "customer": return tr.text("calendar.agenda.bookedOnline");
    case "automation": return tr.text("provenance.automation");
    case "import": return tr.text("provenance.import");
  }
}

export function customerName(tr: Tr, c: AgendaBookingRow["contact"]): string {
  return `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || tr.text("calendar.job.customerFallback");
}
export function addressLine(p: AgendaBookingRow["place"]): string | null {
  const label = p?.label?.trim();
  if (label) return label;
  return p?.address?.split("\n")[0]?.trim() || null;
}

/** The long heading of a day, in the account's zone ("Wednesday, November 4"). */
export function dayHeading(day: AgendaDay, tz: string, locale: Locale): string {
  return Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" })
    .format(day.start);
}

/** "Sun 1" / "dom 1": a week column's head and the phone's day strip. */
export function dayShort(day: AgendaDay, tz: string, locale: Locale): string {
  const parts = Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone: tz, weekday: "short", day: "numeric" })
    .formatToParts(day.start);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")}`;
}

/** The dates a window shows: a Day's heading, or a Week's first and last day ("Nov 1 – Nov 7"). */
export function windowLabel(days: readonly AgendaDay[], tz: string, locale: Locale): string {
  if (days.length === 1) return dayHeading(days[0]!, tz, locale);
  const fmt = Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone: tz, month: "short", day: "numeric" });
  return `${fmt.format(days[0]!.start)} – ${fmt.format(days[days.length - 1]!.start)}`;
}

/** The closed head (spec 5.2): probed at max(day start, now) on today and later days, so a Closed today set at
 *  9 AM heads today; at its own start on a day already over. Running late is never "closed". */
function closedWords(tr: Tr, day: AgendaDay, status: StatusInput, now: Date): string | null {
  const probe = now.getTime() >= day.start.getTime() && now.getTime() < day.end.getTime() ? now : day.start;
  const cover = coversAppointment(status, probe);
  if (!cover.covered) return null;
  if (cover.kind === "storm") return tr.text("business.state.storm");
  if (cover.kind === "closed_today") return tr.text("business.state.closedToday");
  const range = status.closedDays.find((r) => r.starts_on <= day.key && day.key <= r.ends_on);
  return range?.reason ? tr.text("calendar.agenda.closed", { reason: tr.text(`business.reason.${range.reason}`) })
    : tr.text("calendar.agenda.closedPlain");
}

const wallStart = (at: Date, tz: string) => {
  const p = partsInZone(at, tz);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
};

export function buildAgendaView(i: {
  rows: readonly AgendaBookingRow[]; window: { days: AgendaDay[] }; now: Date; timezone: string; locale: Locale;
  pseudo?: boolean; openHours: OpenHours; status: StatusInput; names: Readonly<Record<string, string>>; viewerId: string;
  persona: string | null; calendarMeetingType: BookingMeetingType; canAdd: boolean; baseHref: string; view: AgendaView;
  /** The URL's own `day`: every row's href keeps it, so closing the drawer lands where it opened. */
  day: string;
}): AgendaDayView[] {
  const tr = makeTr(i.locale, i.pseudo);
  const shown = i.rows.filter((r) => !r.replaced && (i.view === "day" || r.status !== "cancelled"));
  return i.window.days.map((day) => {
    const on = shown.filter((r) => Date.parse(r.starts_at) < day.end.getTime() && Date.parse(r.ends_at) > day.start.getTime());
    const { items, overlapping } = agendaLanes(on.map((r) => ({
      id: r.id, startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), live: r.status !== "cancelled",
    })));
    const rows = on.map((r): AgendaRowView => {
      const start = new Date(r.starts_at);
      const end = new Date(r.ends_at);
      const live = r.status !== "cancelled";
      return {
        id: r.id, href: agendaHref(i.baseHref, { view: i.view, day: i.day, job: r.id }), startsAt: r.starts_at,
        startLabel: agendaTime(start, i.timezone, i.locale, day.zoneShift),
        endLabel: agendaTime(end, i.timezone, i.locale, day.zoneShift),
        customer: customerName(tr, r.contact), what: r.note?.trim() || null, address: addressLine(r.place),
        meetingWord: meetingWord(tr, r.meeting_type ?? i.calendarMeetingType),
        statusWord: statusWord(tr, r.status), status: r.status, live,
        overlaps: overlapping.has(r.id), outsideHours: live && !fitsOpenHours(i.openHours, start, end, i.timezone),
        madeBy: madeByWords(tr, r.author_kind, r.author_id, { viewerId: i.viewerId, names: i.names, persona: i.persona }),
        confirmReply: r.confirm_reply, confirmWord: r.confirm_reply ? tr.text(CONFIRM_KEY[r.confirm_reply]) : null,
      };
    });
    const closed = closedWords(tr, day, i.status, i.now);
    const free = i.view === "day" && i.canAdd && closed === null
      ? freeHours({
        dayKey: day.key, timezone: i.timezone, openHours: i.openHours, now: i.now,
        live: on.filter((r) => r.status !== "cancelled").map((r) => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) })),
      }).map((at) => ({
        at: at.toISOString(), start: wallStart(at, i.timezone),
        label: tr.text("calendar.agenda.addAt", { time: agendaTime(at, i.timezone, i.locale, day.zoneShift) }),
      }))
      : [];
    return {
      key: day.key, heading: dayHeading(day, i.timezone, i.locale), short: dayShort(day, i.timezone, i.locale), href: agendaHref(i.baseHref, { view: "day", day: day.key }),
      closed, rows, lanes: items, cancelled: rows.filter((r) => !r.live), free,
    };
  });
}


/** A claim this recent may still be sending: the drawer says "in a few seconds", not "couldn't". */
const SEND_GRACE_MS = 60_000;

/** The email line's state (spec 5.5): sent once stamped; pending while the hold is unsettled or just claimed;
 *  failed once claimed and never stamped; none when no email was wanted, or the job left "booked" unsent. */
export function jobEmailState(r: AgendaBookingRow, now: Date): JobEmailState {
  const kind = r.notice_wanted;
  if (!kind) return { state: "none", kind: null, at: null };
  if (r.notice_sent_at) return { state: "sent", kind, at: r.notice_sent_at };
  if (r.status !== "booked") return { state: "none", kind: null, at: null };
  if (!r.hold_settled_at || now.getTime() - Date.parse(r.hold_settled_at) < SEND_GRACE_MS) return { state: "pending", kind, at: null };
  return { state: "failed", kind, at: null };
}

/** F-046 part 1 (spec 5.5): the drawer's view of one job, read on the caller's own client by the page. */
export function buildJobDrawerView(i: {
  row: AgendaBookingRow; now: Date; timezone: string; locale: Locale; pseudo?: boolean;
  names: Readonly<Record<string, string>>; viewerId: string; persona: string | null; calendarMeetingType: BookingMeetingType;
  /** seesWholeAccount: Move and Cancel (spec 8.1). Completed and No-show are every role's (owner decision 1). */
  canWrite: boolean; told: boolean; accountId: string; language: "en" | "es" | null;
}): JobDrawerView {
  const tr = makeTr(i.locale, i.pseudo);
  const r = i.row;
  const start = new Date(r.starts_at);
  const place = [r.place?.label?.trim(), r.place?.address?.split("\n").map((s) => s.trim()).filter(Boolean).join(", ")]
    .filter(Boolean).join(" · ");
  return {
    id: r.id,
    customer: {
      id: r.contact_id, name: customerName(tr, r.contact), first: r.contact?.first_name?.trim() || tr.text("calendar.job.customerFallback"),
      phone: r.contact?.phone ?? null, email: r.contact?.email ?? null, language: i.language,
    },
    when: formatWhen(start, i.timezone, i.locale), lengthMinutes: Math.round((Date.parse(r.ends_at) - start.getTime()) / 60_000),
    what: r.note?.trim() || null, address: place || null,
    meetingType: r.meeting_type ?? i.calendarMeetingType, meetingUrl: r.meeting_url, status: r.status, statusWord: statusWord(tr, r.status),
    madeBy: madeByWords(tr, r.author_kind, r.author_id, { viewerId: i.viewerId, names: i.names, persona: i.persona }),
    madeAt: formatWhen(new Date(r.created_at), i.timezone, i.locale), confirmReply: r.confirm_reply,
    email: jobEmailState(r, i.now),
    holdOpen: r.hold_until !== null && r.hold_settled_at === null, isMove: r.rescheduled_from_id !== null,
    started: start.getTime() <= i.now.getTime(), canWrite: i.canWrite, canCloseOut: true,
    opened: { startsAt: r.starts_at, endsAt: r.ends_at, note: r.note, placeId: r.place_id, meetingType: r.meeting_type, meetingUrl: r.meeting_url },
    told: i.told, recordHref: `/dashboard/accounts/${i.accountId}/contacts/${r.contact_id}`,
  };
}
