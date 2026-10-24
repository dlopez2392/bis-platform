// S-47d fix round C8 (design review I9 + final M-6): ONE row for an appointment a closure affects, used by
// the dashboard's status card (a server component) and the Calendar page's Closed days card (a client
// component), so the two lists cannot drift apart again (they had: "name — time" on one, "time · name" on
// the other, a held count on one only, a "Kept" BUTTON on one).
//
// Presentational only: no hooks, no state, and NO server imports (no database, no Clerk, no request
// helpers; `affected-appointment-row.test.ts` checks the source). A client module importing a server-only
// one broke the build once already (`business-status-card-error.tsx`'s own header says how). The caller
// passes its own Keep control, because the two cards keep through different wiring.
import Link from "next/link";
import type { ReactNode } from "react";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { appointmentWhen } from "@/lib/business-status/labels";

export type AffectedAppointment = {
  id: string;
  contactId: string;
  /** The contact's full name; "" when the record has none (the row then reads `contact.noName`). */
  name: string;
  startsAt: string;
  /** Held reminder messages for this booking (`countHeldByBooking`). */
  held: number;
  kept: boolean;
};

const TAP = "inline-flex min-h-11 items-center md:min-h-8";

export function AffectedAppointmentRow({
  accountId, appointment, timezone, locale, pseudo = false, canAct, keep, id,
}: {
  accountId: string;
  appointment: AffectedAppointment;
  /** The ACCOUNT's zone: the row renders on the server and again in the browser, and must agree. */
  timezone: string;
  locale: Locale;
  pseudo?: boolean;
  /** `seesWholeAccount`: Keep and "Cancel on the calendar" only for whoever may use them (a Technician
   *  may see the row and may not keep or cancel it, so neither control is offered). */
  canAct: boolean;
  /** The caller's own Keep control, shown only while the appointment is not kept. */
  keep: ReactNode;
  id?: string;
}) {
  const tr = makeTr(locale, pseudo);
  const a = appointment;
  const kept = <span className="text-sm text-muted-foreground">{tr.text("business.card.kept")}</span>;
  return (
    <li
      id={id} data-affected-appointment={a.id}
      className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-[var(--line)] py-1 first:border-t-0"
    >
      <div className="min-w-0 text-sm">
        <span className="tabular-nums text-muted-foreground">{appointmentWhen(a.startsAt, timezone, locale)}</span>
        {" · "}
        <Link
          href={`/dashboard/accounts/${accountId}/contacts/${a.contactId}`}
          className={`${TAP} font-medium text-card-foreground underline-offset-2 hover:underline`}
        >
          {a.name || tr.text("contact.noName")}
        </Link>
        {a.held > 0 ? (
          <span className="block text-xs text-muted-foreground">
            {a.held === 1 ? tr.text("business.card.waitingOne") : tr.text("business.card.waiting", { n: a.held })}
          </span>
        ) : null}
      </div>
      {canAct ? (
        <div className="flex items-center gap-2">
          {a.kept ? kept : keep}
          <Link
            href={`/dashboard/accounts/${accountId}/calendar#booking-${a.id}`}
            className={`${TAP} px-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline`}
          >
            {tr.text("business.card.cancelOnCalendar")}
          </Link>
        </div>
      ) : a.kept ? kept : null}
    </li>
  );
}
