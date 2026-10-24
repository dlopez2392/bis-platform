// S-47d fix round D12: the dashboard status card's PRESENTATION, split from its reads
// (`business-status-card.tsx`, the async server card, which computes these props and renders this). Pure
// and with NO server imports, so `/styleguide` can show every state with static props — open, closed with
// its affected rows, running late — beside the real card's error state (`business-status-card-error.tsx`).
import Link from "next/link";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessStatusMenu } from "@/components/business-status-menu";
import { KeepAppointmentButton } from "./keep-appointment-button";
import { AffectedAppointmentRow, type AffectedAppointment } from "./affected-appointment-row";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { MessageKey } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import type { EffectiveStatus, StoredState } from "@/lib/business-status/status";
import { cardEndLine, cardLongDate } from "@/lib/business-status/labels";
import type { ShellBusinessStatus } from "../shell-actions";

export type AffectedView = { appointments: AffectedAppointment[]; capped: boolean; windowTo: Date };

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

/** A reason inside a sentence ("Closed today (holiday)", "Next closed day: … (holiday)") is lowercase,
 *  the spec's own form; the catalogue's labels are capitalised for the Select and the Closed days list
 *  where they stand alone (fix round D8). */
function inlineReason(tr: Tr, reason: string): string {
  return tr.text(`business.reason.${reason}` as MessageKey).toLocaleLowerCase(tr.locale === "es" ? "es" : "en");
}

function ChangeTrigger({
  accountId, status, locale, pseudo, tr,
}: { accountId: string; status: ShellBusinessStatus; locale: Locale; pseudo: boolean; tr: Tr }) {
  if (!status.canChange) return null;
  return (
    <BusinessStatusMenu
      accountId={accountId} status={status} locale={locale} pseudo={pseudo} triggerKind="action"
      trigger={<span>{tr.text("business.card.change")}</span>}
    />
  );
}

function AffectedList({
  accountId, affected, timezone, locale, pseudo, tr, canAct,
}: {
  accountId: string; affected: AffectedView; timezone: string; locale: Locale; pseudo: boolean; tr: Tr; canAct: boolean;
}) {
  if (affected.appointments.length === 0) {
    return <p className="text-sm text-muted-foreground">{tr.text("business.card.noneAffected")}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {tr.text("business.card.affectedAppointments")}
      </p>
      {/* Fix round C8: the ONE row the Calendar page's Closed days card draws too. */}
      <ul>
        {affected.appointments.map((a) => (
          <AffectedAppointmentRow
            key={a.id} id={`booking-${a.id}`}
            accountId={accountId} appointment={a} timezone={timezone} locale={locale} pseudo={pseudo} canAct={canAct}
            keep={<KeepAppointmentButton accountId={accountId} bookingId={a.id} locale={locale} pseudo={pseudo} />}
          />
        ))}
      </ul>
      {affected.capped ? (
        <p className="text-xs text-muted-foreground">
          <Link href={`/dashboard/accounts/${accountId}/calendar`} className="hover:underline">
            {tr.text("business.card.moreLater", { date: cardLongDate(affected.windowTo, timezone, locale) })}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function BusinessStatusCardView({
  accountId, status, effective, timezone, now, locale, pseudo, affected, canAct, id = "business-status",
}: {
  accountId: string;
  /** What the menu reads: the wire status and who may change it. */
  status: ShellBusinessStatus;
  effective: EffectiveStatus;
  timezone: string;
  /** The ONE instant the card's words were computed at (the server card's own `now`). */
  now: Date;
  locale: Locale;
  pseudo: boolean;
  /** null while running late (no list is read) or when the closure covers no window. */
  affected: AffectedView | null;
  /** `seesWholeAccount`: Keep and "Cancel on the calendar" on each row (fix round C5). */
  canAct: boolean;
  /** The card's anchor; only the styleguide, which shows several, names its own. */
  id?: string;
}) {
  const tr = makeTr(locale, pseudo);
  const dotClass = effective.state === "running_late" ? "bg-[var(--warn)]" : "bg-[var(--crit)]";

  return (
    <Card id={id} data-state={effective.state} lang={locale}>
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
                      reason: inlineReason(tr, effective.nextClosedDay.reason),
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
                ? ` (${inlineReason(tr, effective.reason)})`
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
                accountId={accountId} affected={affected} timezone={timezone} locale={locale} pseudo={pseudo} tr={tr}
                canAct={canAct}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
