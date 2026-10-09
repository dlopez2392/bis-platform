"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BookingRow, BookingStatus } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DotPill } from "@/components/dot-pill";
import { m } from "@/lib/messages";
import { CONFIRM_REPLY_TREATMENTS } from "./confirm-reply";
import { runCancelWithUndo } from "./cancel-booking";
import { CancelDialog } from "./cancel-dialog";
import { cancelStep, NO_NOTICE } from "./cancel-flow";
import type { ActionResult, CancelBookingResult, CancelNoticeChoice, CancelNoticeOptionResult } from "./actions";

type Booking = BookingRow & { contact_name: string; contact_email: string | null };

const STATUS_LABEL: Record<BookingStatus, string> = {
  booked: m["calendar.bookings.status.booked"],
  cancelled: m["calendar.bookings.status.cancelled"],
  completed: m["calendar.bookings.status.completed"],
  no_show: m["calendar.bookings.status.no_show"],
};
const STATUS_VARIANT: Record<BookingStatus, "default" | "secondary" | "destructive" | "outline"> = {
  booked: "default",
  cancelled: "outline",
  completed: "secondary",
  no_show: "destructive",
};

/** `en-CA` gives a sortable, zone-stable `YYYY-MM-DD` grouping key straight
 *  from Intl — no manual y/m/d assembly, and `timeZone` is always passed
 *  explicitly, never the system zone (the recorded Cobija weekday-picker
 *  lesson: a zone behind UTC renders the day before if this is skipped). */
function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function dayHeading(iso: string, timeZone: string): string {
  // "en-US", never `undefined` (the house pattern — see `lib/format.ts`):
  // this dashboard route renders server-side first, so an `undefined` locale
  // resolves to the SERVER's locale during SSR and the operator's BROWSER
  // locale after hydration — a mismatch for every es-* operator.
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone,
  }).format(new Date(iso));
}

/** Both start AND end carry the date, not bare `HH:MM` — the recorded
 *  quirk: a DST fall-back day's repeated hour can format a real,
 *  non-zero-length booking as "1:00 AM → 1:00 AM", which reads as a
 *  mistake. Carrying the date on both sides doesn't resolve the underlying
 *  ambiguity (a repeated wall-clock hour is genuinely indistinguishable
 *  without a UTC offset), but it stops the row from reading as a
 *  zero-length appointment on any day that crosses midnight or lands in
 *  that hour. */
function timeRange(startsAt: string, endsAt: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone,
  });
  return `${fmt.format(new Date(startsAt))} → ${fmt.format(new Date(endsAt))}`;
}

function StatusActions({
  booking, started, when, statusAction, noticeOptionAction, cancelAction, undoCancelAction,
}: {
  booking: Booking;
  /** D-030: the appointment's start is at or before the page's `nowIso`. */
  started: boolean;
  /** The row's own time, in the account's zone, for the Cancel dialog. */
  when: string;
  statusAction: (bookingId: string, status: BookingStatus) => Promise<ActionResult>;
  noticeOptionAction: (bookingId: string) => Promise<CancelNoticeOptionResult>;
  cancelAction: (bookingId: string, notice: CancelNoticeChoice) => Promise<CancelBookingResult>;
  undoCancelAction: (bookingId: string, version: string, noticeMessageId?: string) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Once a booking has left "booked" it has no buttons here. The one way
  // back is the Undo on Cancel's own toast (D-036), never a button on the row.
  if (booking.status !== "booked") return null;

  function run(status: BookingStatus) {
    startTransition(async () => {
      const result = await statusAction(booking.id, status);
      if (result.ok) toast.success(m["calendar.bookings.statusUpdated"]);
      else toast.error(result.error);
    });
  }

  // D-036: Cancel runs at once and its toast carries Undo (DESIGN.md rule 6;
  // see `./cancel-booking.ts` for why this cancel is reversible). F-048: when
  // a customer notice can go, the dialog composes it first and it goes only
  // once the Undo has closed; when none can, Cancel cancels at once and the
  // toast says why nobody was told (`./cancel-flow.ts`).
  async function cancelWith(notice: CancelNoticeChoice, noNoticeMessage?: string) {
    await runCancelWithUndo(
      () => cancelAction(booking.id, notice),
      (version, noticeMessageId) => undoCancelAction(booking.id, version, noticeMessageId),
      toast,
      { noNoticeMessage },
    );
  }

  function onCancel() {
    startTransition(async () => {
      const first = cancelStep(booking.contact_email, null);
      if (first.kind === "now") return void (await cancelWith(NO_NOTICE, first.toast));
      let option: CancelNoticeOptionResult;
      try {
        option = await noticeOptionAction(booking.id);
      } catch {
        toast.error(m["common.actionCrashed"]);
        return;
      }
      if (!option.ok) return void toast.error(option.error);
      const next = cancelStep(booking.contact_email, option.notice);
      if (next.kind === "dialog") setDialogOpen(true);
      else if (next.kind === "now") await cancelWith(NO_NOTICE, next.toast);
    });
  }

  function confirmFromDialog(notice: CancelNoticeChoice) {
    startTransition(async () => { await cancelWith(notice); });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {/* D-030: outcomes exist only once the appointment has started. The
          server action refuses them before that too (`startedBy`); hiding
          them here is the courtesy, not the control. */}
      {started ? (
        <>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run("completed")}>
            {m["calendar.bookings.markCompleted"]}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run("no_show")}>
            {m["calendar.bookings.markNoShow"]}
          </Button>
        </>
      ) : null}
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onCancel}>
        {m["calendar.bookings.cancel"]}
      </Button>
      {dialogOpen ? (
        <CancelDialog
          contactName={booking.contact_name}
          when={when}
          onOpenChange={setDialogOpen}
          onConfirm={confirmFromDialog}
        />
      ) : null}
    </div>
  );
}

export function BookingsList({
  accountId, timezone, bookings, nowIso, statusAction, noticeOptionAction, cancelAction, undoCancelAction,
}: {
  accountId: string;
  /** The ACCOUNT zone (spec: grouped by day in the account zone, not the
   *  browser's or the booker's own). */
  timezone: string;
  bookings: Booking[];
  /** The server's clock at render, the same instant the page listed from.
   *  Decides which rows have STARTED (D-030). A prop, never `Date.now()` in
   *  here: the server render and the hydrated client must agree. */
  nowIso: string;
  statusAction: (bookingId: string, status: BookingStatus) => Promise<ActionResult>;
  /** F-048: can a customer notice go for this booking? Asked before the
   *  dialog opens; only "available" opens it. */
  noticeOptionAction: (bookingId: string) => Promise<CancelNoticeOptionResult>;
  /** F-048: Cancel, with the customer notice the dialog composed, or none. */
  cancelAction: (bookingId: string, notice: CancelNoticeChoice) => Promise<CancelBookingResult>;
  /** D-036: the Undo on Cancel's toast, naming the cancel's version and the
   *  notice's queued thread row, when there is one. */
  undoCancelAction: (bookingId: string, version: string, noticeMessageId?: string) => Promise<ActionResult>;
}) {
  const groups = new Map<string, { heading: string; items: Booking[] }>();
  for (const b of bookings) {
    const key = dayKey(b.starts_at, timezone);
    if (!groups.has(key)) groups.set(key, { heading: dayHeading(b.starts_at, timezone), items: [] });
    groups.get(key)!.items.push(b);
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{m["calendar.bookings.title"]}</CardTitle></CardHeader>
      <CardContent>
        {bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m["calendar.bookings.empty"]}</p>
        ) : (
          <div className="space-y-6">
            {[...groups.entries()].map(([key, group]) => (
              <div key={key}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.heading}
                </p>
                <ul className="divide-y divide-border">
                  {group.items.map((b) => (
                    <li key={b.id} className="space-y-1.5 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-card-foreground">
                          {timeRange(b.starts_at, b.ends_at, timezone)}
                        </span>
                        <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                        {/* The customer's own answer to the confirmation text (0047,
                            written by the inbound SMS webhook). DOT AND WORD, never
                            colour alone (DESIGN.md rule 3) — through the shared
                            `DotPill` (components/dot-pill.tsx), the same pill
                            `LogStatusPill` wraps, so this pill and the
                            automation-history pills ARE one system rather than two
                            that happen to match today. A yes wears the history's
                            `sent`; a NO wears the warning treatment, because it is
                            the one answer here an operator must act on (see
                            ./confirm-reply.ts). `dense`: no padding override, unlike
                            LogStatusPill's `py-1 pr-2.5 pl-2` — the badge's own
                            `px-2 py-0.5` is what the status badge next to it uses.

                            Rendered for EVERY status, cancelled included: "they
                            confirmed, and then it was cancelled" is a true thing and
                            arguably the most useful row on the screen. Only
                            `StatusActions` below gates on status.

                            `confirm_reply_at` is selected and typed but deliberately
                            NOT shown: the answer is what an operator acts on, the
                            minute it arrived is not. */}
                        {b.confirm_reply ? (
                          <DotPill
                            {...CONFIRM_REPLY_TREATMENTS[b.confirm_reply]}
                            dense
                            testId="booking-confirm-reply"
                          />
                        ) : null}
                        <Link
                          href={`/dashboard/accounts/${accountId}/contacts/${b.contact_id}`}
                          className="text-xs text-primary underline"
                        >
                          {b.contact_name}
                        </Link>
                        {b.meeting_url ? (
                          // New tab, never navigating the operator away from
                          // their own dashboard — same reasoning as the
                          // contact link staying in-app while this one leaves it.
                          <a
                            href={b.meeting_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary underline"
                          >
                            {m["calendar.bookings.join"]}
                          </a>
                        ) : null}
                      </div>
                      {b.note ? (
                        <p className="text-sm text-muted-foreground">
                          <span className="sr-only">{m["calendar.bookings.note"]}: </span>
                          {b.note}
                        </p>
                      ) : null}
                      <StatusActions
                        booking={b}
                        started={new Date(b.starts_at).getTime() <= new Date(nowIso).getTime()}
                        when={timeRange(b.starts_at, b.ends_at, timezone)}
                        statusAction={statusAction}
                        noticeOptionAction={noticeOptionAction}
                        cancelAction={cancelAction}
                        undoCancelAction={undoCancelAction}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
