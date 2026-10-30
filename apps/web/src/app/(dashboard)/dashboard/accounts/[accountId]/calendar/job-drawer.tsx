"use client";

import { useState, useTransition, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BookingMeetingType, BookingStatus } from "@bis/db";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { DotPill } from "@/components/dot-pill";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { CONFIRM_REPLY_TREATMENTS } from "./confirm-reply";
import { runCancelWithUndo } from "./cancel-booking";
import { CancelDialog } from "./cancel-dialog";
import { runCancelButton, NO_NOTICE } from "./cancel-flow";
import {
  cancelBookingAction, cancelNoticeOptionAction, setBookingStatusAction, undoCancelBookingAction, type CancelNoticeChoice,
} from "./actions";
import { undoAddJobAction, type JobOpened } from "./agenda-actions";
import { JobForm } from "./job-sheet";
import {
  cancelFromDrawer, closeOut, drawerActions, emailLine, focusJobRow, meetingWord, moveJob, movePrefill, JOB_STATUS_TREATMENTS,
  type JobEmailState,
} from "./job-drawer-handlers";

/**
 * F-046 part 1 (plan Task 11, spec 5.5): the job drawer, a right sheet over the agenda opened by a row or by
 * `?job=<id>` (the page reads the job on the caller's own client and notes the customer, correction 7). Flat
 * sections inside the glass sheet (a mono label and row rules, never a glass card in it: the record drawer's
 * rule). NO primary (DESIGN.md rule 8, amended 2026-10-30, owner decision 2): Move, Cancel, Mark completed and
 * No-show are equal ghost buttons, and Open record is a ghost link. Move swaps the body for the Add job form,
 * whose own Save is that form's one primary. Esc and the close button leave by the URL (`closeHref`), and focus
 * goes back to the job's row (`#booking-<id>`).
 */

export type JobDrawerView = {
  id: string;
  /** `email`: whether the ordinary Cancel can ask about a notice at all (cancel-flow.ts); `language`: the Cancel
   *  dialog's starting language for this customer (recipientLanguage), the drawer's own when absent. */
  customer: { id: string; name: string; first: string; phone: string | null; email: string | null; language?: "en" | "es" | null };
  /** Formatted by the page in the account's zone, with the zone's short name on a zone-shift day. */
  when: string; lengthMinutes: number; what: string | null; address: string | null;
  meetingType: BookingMeetingType; meetingUrl: string | null; status: BookingStatus; statusWord: string;
  madeBy: string; madeAt: string; confirmReply: "yes" | "no" | null;
  email: JobEmailState;
  /** holdOpen: an Undo hold not yet settled (hold_until set, hold_settled_at null); isMove: rescheduled_from_id set. */
  holdOpen: boolean; isMove: boolean; started: boolean; canWrite: boolean; canCloseOut: boolean;
  opened: JobOpened; told: boolean; recordHref: string;
};
export type JobDrawerProps = {
  accountId: string; view: JobDrawerView; closeHref: string; timezone: string; locale: "en" | "es";
  calendarMeetingType: BookingMeetingType; defaultMinutes: number;
};

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const ROW = "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-baseline gap-2 border-t border-[var(--row-line)] py-2 first:border-t-0";
const SECTION = "min-w-0 border-t border-[var(--line)] pt-3";
const ACTION = "h-auto min-h-11 whitespace-normal md:min-h-8";

export function JobDrawer({ accountId, view, closeHref, timezone, locale, calendarMeetingType, defaultMinutes }: JobDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [moving, setMoving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const tx = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);

  function close() {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
  }

  // D-036 / F-048: the Calendar page's ordinary Cancel, at once with Undo; a notice dialog only when one can go.
  async function cancelWith(notice: CancelNoticeChoice, noNoticeMessage?: string) {
    await runCancelWithUndo(
      () => cancelBookingAction(accountId, view.id, notice),
      (version, noticeMessageId) => undoCancelBookingAction(accountId, view.id, version, noticeMessageId),
      toast, { noNoticeMessage },
    );
  }
  const ordinary = () => runCancelButton({
    contactEmail: view.customer.email,
    probe: () => cancelNoticeOptionAction(accountId, view.id),
    openDialog: () => setDialogOpen(true),
    cancelNow: (noNoticeMessage) => cancelWith(NO_NOTICE, noNoticeMessage),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md" closeLabel={tx("drawer.close")}
        data-job-drawer={view.id} onCloseAutoFocus={(e) => focusJobRow(e, view.id)}>
        <div lang={locale} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <JobDrawerHeader view={view} locale={locale} wrapHeading={(h) => <SheetTitle asChild>{h}</SheetTitle>} />
            <SheetDescription className="sr-only">{view.when}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            {moving ? (
              <section aria-label={tx("calendar.job.titleMove")} className="min-w-0 space-y-3">
                <h3 className={LABEL}>{tx("calendar.job.titleMove")}</h3>
                <JobForm accountId={accountId} timezone={timezone} locale={locale} mode="move"
                  prefill={movePrefill(view, timezone)} job={moveJob(view)}
                  calendarMeetingType={calendarMeetingType} defaultMinutes={defaultMinutes}
                  onCancel={() => setMoving(false)}
                  // calendar.job.changed: re-read the page, so this view (and the form's tick) is the job as it is now.
                  onChanged={() => router.refresh()}
                  // A new time is a new row: the drawer's job is now the replaced one, so it closes. An in-place
                  // edit keeps the same row, so the details come back, re-read by the action's revalidation.
                  onDone={({ moved }) => { if (moved) close(); else setMoving(false); }} />
              </section>
            ) : (
              <JobDrawerDetails view={view} timezone={timezone} locale={locale} pending={pending}
                onMove={() => setMoving(true)}
                onCancel={() => startTransition(async () => {
                  await cancelFromDrawer({ accountId, view, locale, toast, undoAdd: undoAddJobAction, ordinary });
                })}
                onCloseOut={(status) => startTransition(async () => {
                  await closeOut({ accountId, bookingId: view.id, status, locale, toast, setStatus: setBookingStatusAction });
                })} />
            )}
          </div>
        </div>
        {dialogOpen ? (
          <CancelDialog contactName={view.customer.name} when={view.when}
            defaultLocale={view.customer.language ?? locale} onOpenChange={setDialogOpen}
            onConfirm={(choice) => startTransition(async () => { await cancelWith(choice); })} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The customer's name (the dialog's title), their phone as a `tel:` link, and the status as dot and word. */
export function JobDrawerHeader({ view, locale, wrapHeading }: {
  view: JobDrawerView; locale: "en" | "es"; wrapHeading?: (h: ReactElement) => ReactNode;
}) {
  const heading = <h2 className="min-w-0 break-words pr-8 text-lg font-semibold text-foreground">{view.customer.name}</h2>;
  const reply = view.confirmReply ? CONFIRM_REPLY_TREATMENTS[view.confirmReply] : null;
  return (
    <div data-job-drawer-header className="min-w-0 space-y-2">
      {wrapHeading ? wrapHeading(heading) : heading}
      {view.customer.phone ? (
        <a href={`tel:${view.customer.phone}`} data-job-phone
          className="inline-flex min-h-11 items-center rounded-[var(--radius-ctl)] text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
          {view.customer.phone}
        </a>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <DotPill label={view.statusWord} {...JOB_STATUS_TREATMENTS[view.status]} dense data-job-status={view.status} />
        {reply && view.confirmReply ? (
          <DotPill chip={reply.chip} dot={reply.dot} dense testId="booking-confirm-reply"
            label={t(m, view.confirmReply === "yes" ? "calendar.bookings.confirmed" : "calendar.bookings.confirmDeclined", locale)} />
        ) : null}
      </div>
    </div>
  );
}

/** The details and the equal ghost actions. Presentational: the styleguide renders it with no-op handlers. */
export function JobDrawerDetails({ view, timezone, locale, pending = false, onMove, onCancel, onCloseOut }: {
  view: JobDrawerView; timezone: string; locale: "en" | "es"; pending?: boolean;
  onMove: () => void; onCancel: () => void; onCloseOut: (status: "completed" | "no_show") => void;
}) {
  const tx = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const can = drawerActions(view);
  const email = emailLine(view.email, timezone, locale);
  const row = (key: MessageKey, value: ReactNode, attr: string) => (
    <div className={ROW} data-job-row={attr}>
      <dt className="text-xs text-muted-foreground">{tx(key)}</dt>
      <dd className="min-w-0 break-words text-sm text-card-foreground">{value}</dd>
    </div>
  );
  return (
    <div className="min-w-0 space-y-3">
      <dl className="min-w-0">
        {row("calendar.job.date", <span className="tabular-nums">{view.when}</span>, "when")}
        {row("calendar.job.length", <span className="tabular-nums">{tx("calendar.job.minutes", { minutes: view.lengthMinutes })}</span>, "length")}
        {view.what ? row("calendar.job.what", view.what, "what") : null}
        {view.address ? row("calendar.job.address", view.address, "address") : null}
        {row("calendar.job.meet", (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{meetingWord(view.meetingType, locale)}</span>
            {view.meetingUrl ? (
              // A new tab: the operator never leaves their own dashboard.
              <a href={view.meetingUrl} target="_blank" rel="noopener noreferrer" data-job-join
                className="rounded-[var(--radius-ctl)] text-primary underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {tx("calendar.bookings.join")}
              </a>
            ) : null}
          </span>
        ), "meet")}
      </dl>

      <div className={cn(SECTION, "space-y-1 text-sm")} data-job-made>
        <p className="break-words text-card-foreground">{view.madeBy}<span aria-hidden> · </span><span className="tabular-nums text-muted-foreground">{view.madeAt}</span></p>
        {email ? <p data-job-email={view.email.state} className="break-words text-muted-foreground">{email}</p> : null}
      </div>

      <div className={cn(SECTION, "flex flex-wrap gap-2")} data-job-actions>
        {can.move ? <Button type="button" variant="ghost" size="sm" className={ACTION} disabled={pending} onClick={onMove}>{tx("calendar.job.titleMove")}</Button> : null}
        {can.cancel ? <Button type="button" variant="ghost" size="sm" className={ACTION} disabled={pending} onClick={onCancel}>{tx("calendar.bookings.cancel")}</Button> : null}
        {can.closeOut ? (
          <>
            <Button type="button" variant="ghost" size="sm" className={ACTION} disabled={pending} onClick={() => onCloseOut("completed")}>{tx("calendar.bookings.markCompleted")}</Button>
            <Button type="button" variant="ghost" size="sm" className={ACTION} disabled={pending} onClick={() => onCloseOut("no_show")}>{tx("calendar.bookings.markNoShow")}</Button>
          </>
        ) : null}
        <Link href={view.recordHref} data-job-open-record className={cn(buttonVariants({ variant: "ghost", size: "sm" }), ACTION)}>
          {tx("calendar.job.openRecord")}
        </Link>
      </div>
    </div>
  );
}
