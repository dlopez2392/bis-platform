import Link from "next/link";
import { ChevronRight, ArrowRight } from "lucide-react";
import type { CallListRow } from "@bis/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { callerLabel, formatCallTime, formatDuration } from "./format";
import { OutcomePill } from "./outcome-pill";
import { CallRow, StopPropagation } from "./call-row";

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
            const label = callerLabel(row);
            // Whether the label is a real identity or the withheld-number
            // fallback — read off the row rather than by comparing the label
            // back against its own message, so a copy change cannot silently
            // restyle every row. Only reached when `row.contact_id` is
            // already falsy (see the branch below), so that disjunct would
            // never be the one making this true.
            const known = Boolean(row.caller_e164?.trim());

            return (
              <CallRow key={row.id} href={callHref} label={label}>
                <TableCell className={CELL}>
                  <span className="font-medium tabular-nums">
                    {formatCallTime(row.started_at, timezone)}
                  </span>
                </TableCell>

                <TableCell className={CELL}>
                  {row.contact_id ? (
                    <StopPropagation>
                      <Link
                        href={`${base}/contacts/${row.contact_id}`}
                        className="font-medium hover:underline"
                      >
                        {label}
                      </Link>
                    </StopPropagation>
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
                  <OutcomePill outcome={row.outcome} />
                </TableCell>

                <TableCell className={cn(CELL, "hidden sm:table-cell")}>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                    {row.language}
                  </span>
                </TableCell>

                {/* Mouse-only sugar: a second, right-aligned affordance so
                    the row reads as openable from either end. The row
                    itself (CallRow) handles the click and the keyboard nav;
                    this is no longer a Link — a nested interactive element
                    inside a whole-row click target would double-fire
                    navigation and confuse the tab order. `aria-hidden`
                    stays: it is decoration, not a second announced target. */}
                <TableCell className="w-10 p-0">
                  <span
                    aria-hidden
                    className="flex items-center justify-end px-4 py-3 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </span>
                </TableCell>
              </CallRow>
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
