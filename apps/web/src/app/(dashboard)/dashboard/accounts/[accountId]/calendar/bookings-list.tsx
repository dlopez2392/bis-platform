"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BookingRow, BookingStatus } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
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
                        <Link
                          href={`/dashboard/accounts/${accountId}/contacts/${b.contact_id}`}
                          className="text-xs text-primary underline"
                        >
                          {b.contact_name}
                        </Link>
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
