import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { SupabaseClient } from "@bis/db";
import {
  listAgendaBookings, countAwaitingOutcomeBefore, listPeopleNames, getVoiceProfile, getBusinessStatusRow,
  listClosedDaysFrom, AGENDA_ROW_CAP, type AgendaBookingRow, type BookingMeetingType,
} from "@bis/db";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";
import { normalizeOpenHours, partsInZone } from "@/lib/booking/slots";
import { agendaWindow, shiftKey, type AgendaView } from "@/lib/booking/agenda-window";
import { addDays, type StatusInput } from "@/lib/business-status/status";
import { agendaHref, buildAgendaView, windowLabel, type AgendaDayView } from "./agenda-view";
import { AddJobButton, AgendaDay, type AgendaSheetContext, type AgendaWords } from "./agenda-day";
import { AgendaWeek } from "./agenda-week";

/**
 * F-046 part 1 (plan Task 12, spec 5.1-5.6): the Agenda card, first on the Calendar page. It reads its own
 * window on the db the page hands it (the request client: RLS decides what a Technician sees, R5) and fails on
 * its own (rule 5 extended to the card): a failed read is this card's error with a Try again link to the same
 * URL, and every best-effort read beside it (names, persona, closures, the past-jobs count) costs only its own
 * line. Add job is the card's ONE primary, in its own header, never in PageHeader (rule 8; spec 14.1).
 */
export type AgendaCalendar = { open_hours: unknown; meeting_type: BookingMeetingType; slot_duration_minutes: number };
export type AgendaCardProps = {
  db: SupabaseClient; accountId: string; view: AgendaView; day: string; today: string;
  /** The page's one instant (Global constraint: no `Date.now()` during render). */
  nowIso: string; timezone: string; locale: Locale; pseudo?: boolean;
  /** Owners, Staff and the agency (seesWholeAccount); a Technician never adds (spec 8.1). */
  canAdd: boolean; viewerId: string; calendar: AgendaCalendar; job?: string | null;
};

const LINK = cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8");

/** The sheet's prefill for the header's Add job: a later day's first free hour (or 09:00), else the next
 *  whole hour from now, today. */
function addPrefill(day: string, today: string, now: Date, tz: string, days: readonly AgendaDayView[]) {
  if (day > today) return { date: day, start: days.find((d) => d.key === day)?.free[0]?.start ?? "09:00" };
  const h = partsInZone(now, tz).hh + 1;
  return h >= 24 ? { date: addDays(today, 1), start: "00:00" } : { date: today, start: `${String(h).padStart(2, "0")}:00` };
}

export type AgendaCardViewProps = Omit<AgendaCardProps, "db" | "viewerId" | "nowIso"> & {
  /** null = the window's read failed: the card's own error state. */
  days: AgendaDayView[] | null; truncated: boolean; pastOpen: number; prefill: { date: string; start: string };
  /** The title's id (aria-labelledby): unique per card where a page shows several (the styleguide). */
  titleId?: string;
};

export function AgendaCardView(p: AgendaCardViewProps) {
  const tr = makeTr(p.locale, p.pseudo);
  const base = `/dashboard/accounts/${p.accountId}/calendar`;
  const titleId = p.titleId ?? "agenda-title";
  const title = <h2 id={titleId} className="text-base font-semibold text-foreground">{tr.text("calendar.agenda.title")}</h2>;

  if (p.days === null) {
    return (
      <section aria-labelledby={titleId} data-agenda-card="error" className="rounded-xl border border-border bg-card glass p-4">
        {title}
        <div role="alert" className="mt-3 space-y-2 text-sm">
          <p className="text-muted-foreground">{tr.text("calendar.agenda.error")}</p>
          <Link href={agendaHref(base, { view: p.view, day: p.day, job: p.job })} className={LINK}>{tr.text("calendar.agenda.retry")}</Link>
        </div>
      </section>
    );
  }

  const sheet: AgendaSheetContext = {
    accountId: p.accountId, timezone: p.timezone, locale: p.locale, pseudo: p.pseudo ?? false,
    calendarMeetingType: p.calendar.meeting_type, defaultMinutes: p.calendar.slot_duration_minutes,
  };
  const words: AgendaWords = {
    overlaps: tr.text("calendar.agenda.overlaps"), outsideHours: tr.text("calendar.agenda.outsideHours"),
    daysLabel: tr.text("calendar.agenda.daysLabel"),
  };
  const window = agendaWindow(p.view, p.day, p.timezone);
  const label = windowLabel(window.days, p.timezone, p.locale);
  const empty = p.days.every((d) => d.rows.length === 0);
  const tab = (v: AgendaView, key: "calendar.agenda.day" | "calendar.agenda.week") => (
    <Link
      href={agendaHref(base, { view: v, day: p.day })}
      aria-current={p.view === v ? "page" : undefined}
      className={cn(LINK, "px-3", p.view === v && "bg-[var(--surface-3)] text-foreground")}
    >
      {tr.text(key)}
    </Link>
  );

  return (
    <section aria-labelledby={titleId} data-agenda-card="ready" className="rounded-xl border border-border bg-card glass">
      <header className="flex flex-col gap-2 border-b border-[var(--line)] p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {title}
          <nav aria-label={tr.text("calendar.agenda.viewLabel")} className="inline-flex gap-0.5 rounded-[var(--radius-ctl)] border border-[var(--line)] p-0.5">
            {tab("day", "calendar.agenda.day")}
            {tab("week", "calendar.agenda.week")}
          </nav>
          {p.canAdd ? (
            <div className="ml-auto">
              <AddJobButton label={tr.text("calendar.agenda.addJob")} sheet={sheet} prefill={p.prefill} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex items-center">
            <Link href={agendaHref(base, { view: p.view, day: shiftKey(p.view, p.day, -1) })} scroll={false} className={LINK}>{tr.text("calendar.agenda.back")}</Link>
            <span aria-hidden className="text-muted-foreground">·</span>
            <Link href={agendaHref(base, { view: p.view, day: p.today })} scroll={false} className={LINK}>{tr.text("calendar.agenda.today")}</Link>
            <span aria-hidden className="text-muted-foreground">·</span>
            <Link href={agendaHref(base, { view: p.view, day: shiftKey(p.view, p.day, 1) })} scroll={false} className={LINK}>{tr.text("calendar.agenda.next")}</Link>
          </div>
          <p data-agenda-date className="text-sm text-muted-foreground tabular-nums">{label}</p>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {p.truncated ? (
          <p data-agenda-truncated role="status" className="text-sm text-muted-foreground">
            {/* A Day IS a single day: never "Open a single day" there (T11/T12 review minor). */}
            {tr.text(p.view === "day" ? "calendar.agenda.truncatedDay" : "calendar.agenda.truncated", { cap: AGENDA_ROW_CAP })}
          </p>
        ) : null}
        {p.pastOpen > 0 ? (
          <Link data-agenda-past href={`/dashboard/accounts/${p.accountId}/tasks`} className={cn(LINK, "h-auto whitespace-normal px-0 text-left")}>
            {tr.count("calendar.agenda.pastOpen", p.pastOpen)}
          </Link>
        ) : null}
        {empty ? (
          <EmptyState
            icon={CalendarDays}
            className="py-8"
            title={tr.text(p.canAdd ? "calendar.agenda.emptyTitle" : "calendar.agenda.emptyTechnician", { day: label })}
            body={p.canAdd ? tr.text("calendar.agenda.emptyBody") : undefined}
            action={p.canAdd ? <AddJobButton variant="ghost" label={tr.text("calendar.agenda.addJob")} sheet={sheet} prefill={p.prefill} /> : undefined}
          />
        ) : null}
        {p.view === "day"
          ? <AgendaDay day={p.days[0]!} words={words} sheet={sheet} />
          : (
            <AgendaWeek
              days={p.days} selected={p.day} words={words}
              weekHref={Object.fromEntries(p.days.map((d) => [d.key, agendaHref(base, { view: "week", day: d.key })]))}
            />
          )}
      </div>
    </section>
  );
}

/** Logged and swallowed: a best-effort read costs its own line, never the card. */
function soft<T>(what: string, accountId: string, fallback: T) {
  return (e: unknown): T => {
    console.error(`calendar agenda: ${what} read failed for account ${accountId}: ${String(e)}`);
    return fallback;
  };
}

export async function AgendaCard(p: AgendaCardProps) {
  const { db, accountId, timezone } = p;
  const now = new Date(p.nowIso);
  const window = agendaWindow(p.view, p.day, timezone);
  let list: { rows: AgendaBookingRow[]; truncated: boolean } | null = null;
  try {
    list = await listAgendaBookings(db, accountId, window.from.toISOString(), window.to.toISOString());
  } catch (e) {
    console.error(`calendar agenda: window read failed for account ${accountId}: ${String(e)}`);
  }
  const common = { ...p, db: undefined, viewerId: undefined, nowIso: undefined };
  if (list === null) {
    return <AgendaCardView {...common} days={null} truncated={false} pastOpen={0} prefill={{ date: p.day, start: "09:00" }} />;
  }
  const rows = list.rows;
  const openHours = normalizeOpenHours(p.calendar.open_hours);
  const personIds = [...new Set(rows.filter((r) => r.author_kind === "person" && r.author_id).map((r) => r.author_id!))];
  const [names, persona, closures, pastOpen] = await Promise.all([
    personIds.length > 0 ? listPeopleNames(db, personIds).catch(soft("names", accountId, {})) : Promise.resolve({}),
    rows.some((r) => r.author_kind === "ai")
      ? getVoiceProfile(db, accountId).then((v) => v?.persona_name?.trim() || null).catch(soft("persona", accountId, null))
      : Promise.resolve(null),
    Promise.all([getBusinessStatusRow(db, accountId), listClosedDaysFrom(db, accountId, window.days[0]!.key)])
      .then(([row, closedDays]) => ({ row, closedDays })).catch(soft("closures", accountId, null)),
    // Carry-in 4: every job over and still booked, the To do list's own predicate (work-queue.ts staleBookings).
    countAwaitingOutcomeBefore(db, accountId, p.nowIso).catch(soft("past jobs", accountId, 0)),
  ]);
  const status: StatusInput = {
    row: closures?.row ? { state: closures.row.state, late_minutes: closures.row.late_minutes, until: closures.row.until, set_at: closures.row.set_at } : null,
    closedDays: closures?.closedDays ?? [], hours: openHours, timezone, now,
  };
  const days = buildAgendaView({
    rows, window, now, timezone, locale: p.locale, pseudo: p.pseudo, openHours, status, names, viewerId: p.viewerId,
    persona, calendarMeetingType: p.calendar.meeting_type, canAdd: p.canAdd,
    baseHref: `/dashboard/accounts/${accountId}/calendar`, view: p.view, day: p.day,
  });
  return (
    <AgendaCardView
      {...common} days={days} truncated={list.truncated} pastOpen={pastOpen}
      prefill={addPrefill(p.day, p.today, now, timezone, days)}
    />
  );
}
