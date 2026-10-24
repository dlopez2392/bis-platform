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
//
// Fix round D12: this file is the READS only; what the card shows is `business-status-card-view.tsx`,
// which `/styleguide` renders with static props.
import {
  getBusinessStatusRow, listClosedDaysFrom, readHoursChain, listClosureAppointments, countHeldByBooking,
  CLOSURE_APPOINTMENTS_LIMIT, type AccountRole, type ClosureAppointment,
} from "@bis/db";
import { dbForRequest } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { seesWholeAccount } from "@/lib/auth-role";
import type { Locale } from "@/lib/i18n/locale";
import {
  addDays, closureListWindow, coversAppointment, dayKey, effectiveStatus, hoursChain, toWire,
} from "@/lib/business-status/status";
import { canChangeFor } from "@/lib/business-status/guard";
import type { ShellBusinessStatus } from "../shell-actions";
import type { AffectedAppointment } from "./affected-appointment-row";
import { BusinessStatusCardView, type AffectedView } from "./business-status-card-view";

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Spec §5.1/§7, Task 4/8: the one window the card lists and the To-do filer counts agree on
 *  (`closureListWindow`), each row kept only when `coversAppointment` still covers it (so one open day
 *  between two closed ranges is excluded, S22). */
async function readAffected(
  dbArg: Awaited<ReturnType<typeof dbForRequest>>, accountId: string,
  input: Parameters<typeof closureListWindow>[0],
): Promise<AffectedView | null> {
  const w = closureListWindow(input);
  if (!w) return null;
  const rows: ClosureAppointment[] = await listClosureAppointments(dbArg, accountId, w.from.toISOString(), w.to.toISOString());
  const covered = rows.filter((r) => coversAppointment(input, new Date(r.starts_at)).covered);
  const heldCounts = covered.length > 0
    ? await countHeldByBooking(dbArg, accountId, covered.map((r) => r.id))
    : new Map<string, number>();
  const appointments: AffectedAppointment[] = covered.map((r) => ({
    id: r.id, contactId: r.contact_id, startsAt: r.starts_at,
    held: heldCounts.get(r.id) ?? 0, kept: r.closure_kept_at !== null,
    name: fullName(r.first_name, r.last_name),
  }));
  // minors-1b item 5: "more later" is also true when the READ itself hit @bis/db's own row cap —
  // `w.capped` alone only catches the 14-day DATE cap (S7/S22); a window that ends well inside 14 days
  // but whose account has `CLOSURE_APPOINTMENTS_LIMIT` or more booked appointments in it is undercounted
  // the same way, and must say so the same way.
  const capped = w.capped || rows.length === CLOSURE_APPOINTMENTS_LIMIT;
  return { appointments, capped, windowTo: w.to };
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
  const affected = effective.state === "running_late" ? null : await readAffected(db, accountId, input);

  return (
    <BusinessStatusCardView
      accountId={accountId} status={status} effective={effective} timezone={timezone} now={now}
      locale={locale} pseudo={pseudo} affected={affected} canAct={seesWholeAccount({ isAgency, role })}
    />
  );
}
