import type { AgendaBookingRow } from "@bis/db";
import { agendaWindow, type AgendaView } from "@/lib/booking/agenda-window";
import type { OpenHours } from "@/lib/booking/slots";
import type { ClosedDay, StatusInput } from "@/lib/business-status/status";
import { AgendaCardView, type AgendaCardViewProps } from "../accounts/[accountId]/calendar/agenda-card";
import { AgendaSkeleton } from "../accounts/[accountId]/calendar/agenda-skeleton";
import { buildAgendaView } from "../accounts/[accountId]/calendar/agenda-view";

/**
 * F-046 part 1 (plan Task 12, spec 5.2-5.6): the Agenda card in every state it has, from fixed specimens
 * (no reads; the clock is a constant). A Day with two jobs side by side, one outside open hours, a cancelled
 * one and two free hours; a closed Day in Spanish; a Week; a Technician's empty day (no Add job); the card's
 * error; and its skeleton. The rows push a URL and Add job opens T11's sheet, as on the page; tab through a
 * card to see its focus rings, and press Up and Down on a row.
 */
const TZ = "America/Chicago";
const NOW = new Date("2026-11-01T12:00:00.000Z");
const HOURS: OpenHours = {
  mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "13:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]],
};
const CAL = { open_hours: HOURS, meeting_type: "in_person" as const, slot_duration_minutes: 60 };
const HOLIDAY: ClosedDay = { starts_on: "2026-11-05", ends_on: "2026-11-05", reason: "holiday" };
const NAMES = { sg_dan: "Dan" };

const row = (o: Partial<AgendaBookingRow> & { id: string; starts_at: string; ends_at: string }): AgendaBookingRow => ({
  contact_id: "sg-c", status: "booked", note: null, author_kind: "customer", author_id: null, meeting_type: null, meeting_url: null,
  place_id: null, confirm_reply: null, hold_until: null, hold_settled_at: null, notice_wanted: null, notice_sent_at: null,
  rescheduled_from_id: null, created_at: "2026-10-30T12:00:00.000Z",
  contact: { first_name: "Ana", last_name: "Garza", phone: null, email: null }, place: null, replaced: false, ...o,
});
/** Wednesday, November 4: 10:00-11:00 and 10:30-11:30 overlap; 18:00 is after the 13:00 close; 12:00 was cancelled. */
const WEDNESDAY = (p: string): AgendaBookingRow[] => [
  row({ id: `${p}-1`, starts_at: "2026-11-04T16:00:00.000Z", ends_at: "2026-11-04T17:00:00.000Z", author_kind: "person", author_id: "sg_dan",
    note: "Replace the water heater", place: { label: "Casa", address: "1204 Nolana Ave" } }),
  row({ id: `${p}-2`, starts_at: "2026-11-04T16:30:00.000Z", ends_at: "2026-11-04T17:30:00.000Z", meeting_type: "video", confirm_reply: "yes",
    contact: { first_name: "Luis", last_name: "Treviño", phone: null, email: null } }),
  row({ id: `${p}-3`, starts_at: "2026-11-05T00:00:00.000Z", ends_at: "2026-11-05T01:00:00.000Z", author_kind: "ai", note: "Quote for a new AC",
    contact: { first_name: "Marta", last_name: "Salinas", phone: null, email: null } }),
  row({ id: `${p}-4`, starts_at: "2026-11-04T18:00:00.000Z", ends_at: "2026-11-04T18:30:00.000Z", status: "cancelled",
    contact: { first_name: "Rosa", last_name: "Peña", phone: null, email: null } }),
];

function card(o: {
  titleId: string; view: AgendaView; day: string; locale: "en" | "es"; canAdd: boolean; rows: AgendaBookingRow[];
  closedDays?: ClosedDay[]; pastOpen?: number;
}) {
  const window = agendaWindow(o.view, o.day, TZ);
  const status: StatusInput = { row: null, closedDays: o.closedDays ?? [], hours: HOURS, timezone: TZ, now: NOW };
  const days = buildAgendaView({
    rows: o.rows, window, now: NOW, timezone: TZ, locale: o.locale, openHours: HOURS, status, names: NAMES, viewerId: "sg_viewer",
    persona: null, calendarMeetingType: "in_person", canAdd: o.canAdd, baseHref: "/dashboard/accounts/sg/calendar", view: o.view, day: o.day,
  });
  const props: AgendaCardViewProps = {
    titleId: o.titleId, accountId: "sg", view: o.view, day: o.day, today: "2026-11-01", timezone: TZ, locale: o.locale,
    canAdd: o.canAdd, calendar: CAL, days, truncated: false, pastOpen: o.pastOpen ?? 0, prefill: { date: o.day, start: "09:00" },
  };
  return <AgendaCardView {...props} />;
}

export function AgendaDemo() {
  return (
    <div className="w-full space-y-4" data-testid="styleguide-agenda">
      {card({ titleId: "sg-agenda-day", view: "day", day: "2026-11-04", locale: "en", canAdd: true, rows: WEDNESDAY("sg-day"), pastOpen: 2 })}
      {card({
        titleId: "sg-agenda-closed", view: "day", day: "2026-11-05", locale: "es", canAdd: true, closedDays: [HOLIDAY],
        rows: [row({ id: "sg-closed-1", starts_at: "2026-11-05T15:00:00.000Z", ends_at: "2026-11-05T16:00:00.000Z", note: "Revisar el calentador" })],
      })}
      {card({
        titleId: "sg-agenda-week", view: "week", day: "2026-11-04", locale: "en", canAdd: true, closedDays: [HOLIDAY],
        rows: [...WEDNESDAY("sg-week"), row({ id: "sg-week-5", starts_at: "2026-11-06T20:00:00.000Z", ends_at: "2026-11-06T21:00:00.000Z" })],
      })}
      {card({ titleId: "sg-agenda-technician", view: "day", day: "2026-11-06", locale: "en", canAdd: false, rows: [] })}
      <AgendaCardView
        titleId="sg-agenda-error" accountId="sg" view="day" day="2026-11-04" today="2026-11-01" timezone={TZ} locale="en"
        canAdd calendar={CAL} days={null} truncated={false} pastOpen={0} prefill={{ date: "2026-11-04", start: "09:00" }}
      />
      <AgendaSkeleton />
    </div>
  );
}
