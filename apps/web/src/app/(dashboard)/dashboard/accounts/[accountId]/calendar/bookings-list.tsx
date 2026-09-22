"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BookingRow, BookingStatus } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { ActionResult } from "./actions";

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
  booking, statusAction,
}: {
  booking: Booking;
  statusAction: (bookingId: string, status: BookingStatus) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  // The constraint (`bookings_no_overlap`) only binds `status='booked'`, and
  // there is no un-cancel / un-complete path — once a booking has left
  // "booked" it is terminal on this screen.
  if (booking.status !== "booked") return null;

  function run(status: BookingStatus) {
    startTransition(async () => {
      const result = await statusAction(booking.id, status);
      if (result.ok) toast.success(m["calendar.bookings.statusUpdated"]);
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run("completed")}>
        {m["calendar.bookings.markCompleted"]}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run("no_show")}>
        {m["calendar.bookings.markNoShow"]}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run("cancelled")}>
        {m["calendar.bookings.cancel"]}
      </Button>
    </div>
  );
}

export function BookingsList({
  accountId, timezone, bookings, statusAction,
}: {
  accountId: string;
  /** The ACCOUNT zone (spec: grouped by day in the account zone, not the
   *  browser's or the booker's own). */
  timezone: string;
  bookings: Booking[];
  statusAction: (bookingId: string, status: BookingStatus) => Promise<ActionResult>;
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
                            colour alone (DESIGN.md rule 3) — through the real `Badge`
                            and the real STATUS_TREATMENTS (`sent` for a yes, `skipped`
                            for a no), which is what `LogStatusPill` does, so this pill
                            and the automation-history pills ARE one system rather than
                            two that happen to match today. The hand-rolled base classes
                            this replaced were a partial reimplementation missing
                            `font-medium`, `w-fit`, `shrink-0` and `whitespace-nowrap`:
                            it rendered at normal weight beside the `font-medium` status
                            badge on this very row, and could wrap where that badge
                            cannot. No padding override, unlike LogStatusPill's
                            `py-1 pr-2.5 pl-2` — the badge's own `px-2 py-0.5` is what
                            the status badge next to it uses.

                            Rendered for EVERY status, cancelled included: "they
                            confirmed, and then it was cancelled" is a true thing and
                            arguably the most useful row on the screen. Only
                            `StatusActions` below gates on status.

                            `confirm_reply_at` is selected and typed but deliberately
                            NOT shown: the answer is what an operator acts on, the
                            minute it arrived is not. */}
                        {b.confirm_reply ? (
                          <Badge
                            variant="chip"
                            className={cn("gap-1.5", b.confirm_reply === "yes"
                              ? STATUS_TREATMENTS.sent.chip
                              : STATUS_TREATMENTS.skipped.chip)}
                            data-testid="booking-confirm-reply"
                          >
                            <span
                              aria-hidden
                              className={cn("size-[7px] rounded-full", b.confirm_reply === "yes"
                                ? STATUS_TREATMENTS.sent.dot
                                : STATUS_TREATMENTS.skipped.dot)}
                            />
                            {b.confirm_reply === "yes"
                              ? m["calendar.bookings.confirmed"]
                              : m["calendar.bookings.confirmDeclined"]}
                          </Badge>
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
                      <StatusActions booking={b} statusAction={statusAction} />
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
