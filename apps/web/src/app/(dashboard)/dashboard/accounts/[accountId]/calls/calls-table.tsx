import Link from "next/link";
import { ChevronRight, ArrowRight } from "lucide-react";
import type { CallListRow, CallOutcome } from "@bis/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
// The account-zone timestamp formatter the booking flow already established.
// Reused rather than re-derived: a second "format an instant in the account's
// timezone" helper is exactly how two surfaces start disagreeing about what
// time something happened.
import { formatWhen } from "@/lib/booking/time";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { callerLabel, formatDuration } from "./format";

/**
 * Outcome treatment. The hue lives in the DOT and the chip's border/tint, not
 * in the label text: `--success` on a light surface measures ~3.4:1, which is
 * below AA for text this size, and this table is the one screen a client reads
 * top to bottom. A colored dot is a graphical object, held to 3:1, and it
 * carries the same "which outcome is this" signal at a glance.
 *
 * `booked` is the positive one and is the only outcome with a filled chip —
 * it should be the thing the eye finds first in a column of fifty rows.
 * `abandoned` and `spam` deliberately recede: they are the rows a client
 * should NOT be drawn to.
 */
const OUTCOMES: Record<CallOutcome, { label: string; dot: string; chip: string }> = {
  booked: {
    label: m["calls.outcome.booked"],
    dot: "bg-success",
    chip: "border-success/30 bg-success/10 text-foreground",
  },
  lead: {
    label: m["calls.outcome.lead"],
    dot: "bg-primary",
    chip: "border-primary/30 bg-primary/5 text-foreground",
  },
  message: {
    label: m["calls.outcome.message"],
    dot: "bg-accent",
    chip: "border-accent/30 bg-accent/5 text-foreground",
  },
  abandoned: {
    label: m["calls.outcome.abandoned"],
    dot: "bg-muted-foreground/60",
    chip: "border-border bg-transparent text-muted-foreground",
  },
  spam: {
    label: m["calls.outcome.spam"],
    dot: "bg-destructive",
    chip: "border-destructive/25 bg-transparent text-muted-foreground",
  },
};

const HEAD = "px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase";
const CELL = "px-4 py-3";

/**
 * Server component — the paging cursor is a link, not client state, so there
 * is nothing here to hydrate. (`Table` itself is a client component; rendering
 * it with server-rendered children is the normal boundary.)
 */
export function CallsTable({
  rows,
  accountId,
  timezone,
  olderHref,
}: {
  rows: CallListRow[];
  accountId: string;
  /** The ACCOUNT's IANA zone, already validated by the page. Every timestamp
   *  in this table is the company's own wall clock — not the viewer's, which
   *  for an agency operator is routinely a different one. */
  timezone: string;
  /** Present only when a full page came back, i.e. there may be more. */
  olderHref?: string;
}) {
  const base = `/dashboard/accounts/${accountId}`;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>{m["calls.col.when"]}</TableHead>
            <TableHead className={HEAD}>{m["calls.col.caller"]}</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>{m["calls.col.duration"]}</TableHead>
            <TableHead className={HEAD}>{m["calls.col.outcome"]}</TableHead>
            <TableHead className={cn(HEAD, "hidden sm:table-cell")}>
              {m["calls.col.language"]}
            </TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const callHref = `${base}/calls/${row.id}`;
            const outcome = OUTCOMES[row.outcome];
            const label = callerLabel(row);
            // Whether the label is a real identity or the withheld-number
            // fallback — read off the row rather than by comparing the label
            // back against its own message, so a copy change cannot silently
            // restyle every row.
            const known = Boolean(row.contact_id || row.caller_e164?.trim());

            return (
              <TableRow key={row.id} className="group">
                <TableCell className={CELL}>
                  <Link
                    href={callHref}
                    className="font-medium tabular-nums transition-colors hover:text-primary"
                  >
                    {formatWhen(new Date(row.started_at), timezone)}
                  </Link>
                </TableCell>

                <TableCell className={CELL}>
                  {row.contact_id ? (
                    <Link
                      href={`${base}/contacts/${row.contact_id}`}
                      className="font-medium hover:underline"
                    >
                      {label}
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        known ? "tabular-nums text-foreground" : "italic text-muted-foreground",
                      )}
                    >
                      {label}
                    </span>
                  )}
                </TableCell>

                <TableCell className={cn(CELL, "text-right tabular-nums text-muted-foreground")}>
                  {formatDuration(row.duration_secs)}
                </TableCell>

                <TableCell className={CELL}>
                  <Badge variant="outline" className={cn("gap-1.5 py-1 pr-2.5 pl-2", outcome.chip)}>
                    <span className={cn("size-1.5 rounded-full", outcome.dot)} aria-hidden />
                    {outcome.label}
                  </Badge>
                </TableCell>

                <TableCell className={cn(CELL, "hidden sm:table-cell")}>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                    {row.language}
                  </span>
                </TableCell>

                {/* Mouse-only sugar: a second, right-aligned target for the
                    same call, so the row reads as openable from either end.
                    Hidden from assistive tech and skipped by the tab order —
                    one announced link per row is enough.

                    Deliberately NOT a stretched overlay across the whole row:
                    that needs `position: relative` on a <tr>, and where it
                    is not honoured the overlay resolves against the table
                    container instead and swallows every click in the table. */}
                <TableCell className="w-10 p-0">
                  <Link
                    href={callHref}
                    aria-hidden
                    tabIndex={-1}
                    className="flex items-center justify-end px-4 py-3 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {olderHref ? (
        <div className="flex justify-end border-t border-border px-4 py-3">
          <Link href={olderHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {m["calls.older"]}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
