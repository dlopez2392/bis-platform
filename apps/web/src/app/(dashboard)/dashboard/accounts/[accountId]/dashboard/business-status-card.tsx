// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/business-status-card.tsx
//
// S-47d Task 11 (plan "The dashboard card", spec §5.6.2): "is the business open right now, and who
// does it affect" — its own fault-isolated boundary (RecordCardBoundary, wired by page.tsx), never the
// page's, because a closed-status read failing must not blank the KPIs above it (rule 5 extended to
// the card). Its own `dbForRequest()` and its own five @bis/db reads (getBusinessStatusRow,
// listClosedDaysFrom, readHoursChain, listClosureAppointments, countHeldByBooking) — `timezone` arrives
// as a PROP from the page's own already-resolved zone (`renderZone`), so this card never re-reads it;
// `personaName` likewise arrives as a prop (the page's own `getVoiceProfile` call, already made for
// the calls/activity cards) rather than a sixth @bis/db call here, for the same fault-isolation reason
// shell-actions.ts's own doc comment gives for never sharing a profile read across two sections.
import Link from "next/link";
import {
  getBusinessStatusRow, listClosedDaysFrom, readHoursChain, listClosureAppointments, countHeldByBooking,
  type AccountRole, type ClosureAppointment,
} from "@bis/db";
import { dbForRequest } from "@/lib/db";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordCardError } from "@/components/record/record-card";
import { BusinessStatusMenu } from "@/components/business-status-menu";
import { KeepAppointmentButton } from "./keep-appointment-button";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { MessageKey } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import {
  addDays, closureListWindow, coversAppointment, dayKey, effectiveStatus, hoursChain, toWire,
  type EffectiveStatus, type StoredState,
} from "@/lib/business-status/status";
import { canChangeFor } from "@/lib/business-status/guard";
import { cardEndLine, cardLongDate } from "@/lib/business-status/labels";
import type { ShellBusinessStatus } from "../shell-actions";

type Appointment = {
  id: string; contactId: string; startsAt: string; held: number; kept: boolean; name: string;
};

const STATE_WORD_KEY: Record<StoredState, MessageKey> = {
  open: "business.state.open",
  closed_today: "business.state.closedToday",
  running_late: "business.state.runningLate",
  storm: "business.state.storm",
};

/** closed_day reads the same word as closed_today (spec §5.6.1's rule, restated for the card). */
function stateWordKey(effective: EffectiveStatus): MessageKey {
  return STATE_WORD_KEY[effective.state === "closed_day" ? "closed_today" : effective.state];
}

/** "Jun 8, 2:14 PM" — digits + AM/PM, the house convention for a TIME regardless of locale
 *  (bookings-list.tsx's own `timeRange`/`dayHeading`: "en-US", never undefined). */
function appointmentWhen(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone,
  }).format(new Date(startsAt));
}

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Spec §5.1/§7, Task 4/8: the one window the card lists and the To-do filer counts agree on
 *  (`closureListWindow`), each row kept only when `coversAppointment` still covers it (so one open day
 *  between two closed ranges is excluded, S22). */
async function readAffected(
  dbArg: Awaited<ReturnType<typeof dbForRequest>>, accountId: string,
  input: Parameters<typeof closureListWindow>[0],
): Promise<{ appointments: Appointment[]; capped: boolean; windowTo: Date } | null> {
  const w = closureListWindow(input);
  if (!w) return null;
  const rows: ClosureAppointment[] = await listClosureAppointments(dbArg, accountId, w.from.toISOString(), w.to.toISOString());
  const covered = rows.filter((r) => coversAppointment(input, new Date(r.starts_at)).covered);
  const heldCounts = covered.length > 0
    ? await countHeldByBooking(dbArg, accountId, covered.map((r) => r.id))
    : new Map<string, number>();
  const appointments: Appointment[] = covered.map((r) => ({
    id: r.id, contactId: r.contact_id, startsAt: r.starts_at,
    held: heldCounts.get(r.id) ?? 0, kept: r.closure_kept_at !== null,
    name: fullName(r.first_name, r.last_name),
  }));
  return { appointments, capped: w.capped, windowTo: w.to };
}

function ChangeTrigger({
  accountId, status, locale, pseudo, tr,
}: { accountId: string; status: ShellBusinessStatus; locale: Locale; pseudo: boolean; tr: Tr }) {
  if (!status.canChange) return null;
  return (
    <BusinessStatusMenu
      accountId={accountId} status={status} locale={locale} pseudo={pseudo}
      trigger={<span>{tr.text("business.card.change")}</span>}
    />
  );
}

function AffectedList({
  accountId, appointments, capped, windowTo, timezone, locale, pseudo, tr,
}: {
  accountId: string; appointments: Appointment[]; capped: boolean; windowTo: Date;
  timezone: string; locale: Locale; pseudo: boolean; tr: Tr;
}) {
  if (appointments.length === 0) {
    return <p className="text-sm text-muted-foreground">{tr.text("business.card.noneAffected")}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {tr.text("business.card.affectedAppointments")}
      </p>
      <ul className="space-y-2">
        {appointments.map((a) => (
          <li key={a.id} id={`booking-${a.id}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 first:border-t-0 first:pt-0">
            <div className="min-w-0 space-y-0.5 text-sm">
              <span className="tabular-nums text-muted-foreground">{appointmentWhen(a.startsAt, timezone)}</span>
              {" · "}
              <Link href={`/dashboard/accounts/${accountId}/contacts/${a.contactId}`} className="font-medium text-card-foreground hover:underline">
                {a.name}
              </Link>
              {a.held > 0 ? (
                <span className="block text-xs text-muted-foreground">
                  {a.held === 1 ? tr.text("business.card.waitingOne") : tr.text("business.card.waiting", { n: a.held })}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <KeepAppointmentButton accountId={accountId} bookingId={a.id} kept={a.kept} locale={locale} pseudo={pseudo} />
              <Link
                href={`/dashboard/accounts/${accountId}/calendar#booking-${a.id}`}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {tr.text("business.card.cancelOnCalendar")}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {capped ? (
        <p className="text-xs text-muted-foreground">
          <Link href={`/dashboard/accounts/${accountId}/calendar`} className="hover:underline">
            {tr.text("business.card.moreLater", { date: cardLongDate(windowTo, timezone, locale) })}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Rule 7: a skeleton shaped like the compact line this card settles into, not a spinner. */
export function BusinessStatusCardSkeleton() {
  return (
    <Card id="business-status" aria-hidden>
      <CardHeader><CardTitle className="text-sm"><Skeleton className="h-4 w-12 rounded-[var(--radius-ctl)]" /></CardTitle></CardHeader>
      <CardContent><Skeleton className="h-4 w-56 rounded-[var(--radius-ctl)]" /></CardContent>
    </Card>
  );
}

/** Spec §5.6.2: "Couldn't load today's status." with a Retry link (a reload) — the rest of the
 *  dashboard renders regardless (this card's own RecordCardBoundary, never the page's). */
export function BusinessStatusCardError({ locale, onRetry }: { locale: Locale; onRetry?: () => void }) {
  const tr = makeTr(locale);
  return (
    <Card id="business-status" lang={locale}>
      <CardContent className="pt-6">
        <RecordCardError text={tr.text("business.card.error")} retryLabel={tr.text("business.card.retry")} onRetry={onRetry} />
      </CardContent>
    </Card>
  );
}

export async function BusinessStatusCard({
  accountId, timezone, locale, pseudo, isAgency, role, personaName,
}: {
  accountId: string; timezone: string; locale: Locale; pseudo: boolean;
  isAgency: boolean; role: AccountRole | null; personaName: string | null;
}) {
  const db = await dbForRequest();
  const now = new Date();
  const today = dayKey(now, timezone);
  const [row, closedDays, raw] = await Promise.all([
    getBusinessStatusRow(db, accountId),
    listClosedDaysFrom(db, accountId, addDays(today, -1)),
    readHoursChain(db, accountId),
  ]);
  const hours = hoursChain(raw.businessHours, raw.calendarHours);
  const input = { row, closedDays, hours, timezone, now };
  const effective = effectiveStatus(input);
  const canChange = canChangeFor({ isAgency, role }, effective);
  const status: ShellBusinessStatus = {
    effective: toWire(effective), canChange, timezone, personaName, now: now.toISOString(),
  };
  const tr = makeTr(locale, pseudo);
  const affected = effective.state === "running_late" ? null : await readAffected(db, accountId, input);

  const dotClass = effective.state === "running_late" ? "bg-[var(--warn)]" : "bg-[var(--crit)]";

  return (
    <Card id="business-status" data-state={effective.state} lang={locale}>
      <CardHeader>
        <CardTitle className="text-sm">{tr.text("business.card.title")}</CardTitle>
        <CardAction>
          <ChangeTrigger accountId={accountId} status={status} locale={locale} pseudo={pseudo} tr={tr} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {effective.state === "open" ? (
          <>
            <p className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--good)]" />
              {tr.text("business.card.openToday")}
            </p>
            {effective.nextClosedDay ? (
              <p className="text-muted-foreground">
                {effective.nextClosedDay.reason
                  ? tr.text("business.card.nextClosedDayReason", {
                      date: cardLongDate(new Date(`${effective.nextClosedDay.starts_on}T00:00:00Z`), "UTC", locale),
                      reason: tr.text(`business.reason.${effective.nextClosedDay.reason}` as MessageKey),
                    })
                  : tr.text("business.card.nextClosedDay", {
                      date: cardLongDate(new Date(`${effective.nextClosedDay.starts_on}T00:00:00Z`), "UTC", locale),
                    })}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotClass}`} />
              {tr.text(stateWordKey(effective))}
              {effective.state === "closed_day" && effective.reason
                ? ` (${tr.text(`business.reason.${effective.reason}` as MessageKey)})`
                : null}
            </p>
            <p className="text-muted-foreground">{cardEndLine(effective, timezone, now, locale)}</p>
            {effective.state === "running_late" ? (
              <p className="text-muted-foreground">
                {effective.lateMinutes === 120
                  ? tr.text("business.card.lateHidden120")
                  : tr.text("business.card.lateHidden", { minutes: effective.lateMinutes })}
              </p>
            ) : affected ? (
              <AffectedList
                accountId={accountId} appointments={affected.appointments} capped={affected.capped}
                windowTo={affected.windowTo} timezone={timezone} locale={locale} pseudo={pseudo} tr={tr}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
