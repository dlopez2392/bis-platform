import Link from "next/link";
import type { AutomationLogListRow } from "@bis/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { ListPanel } from "@/components/ui/list-panel";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { SOURCE_TITLES, CHANNEL_WORDS } from "@/lib/automations/log-titles";
import { formatCallTime } from "../calls/format";
import { LogStatusPill } from "./log-status-pill";

export const PAGE_SIZE = 25;

const HEAD = "px-4";
const CELL = "px-4 py-3 align-top";

/**
 * Server component: the pager is two links, not client state. Rows are not
 * links — there is no detail page behind a log line — so the whole-row
 * click target rule does not apply; each row is addressed by `data-log-row`.
 */
export function ActivityTable({
  rows, timezone, olderHref, newerHref,
}: {
  rows: AutomationLogListRow[];
  /** The ACCOUNT's zone, already resolved by the page. */
  timezone: string;
  olderHref?: string;
  newerHref?: string;
}) {
  return (
    <div className="space-y-3">
      <ListPanel>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>{m["activity.col.when"]}</TableHead>
              <TableHead className={HEAD}>{m["activity.col.what"]}</TableHead>
              <TableHead className={cn(HEAD, "hidden sm:table-cell")}>{m["activity.col.who"]}</TableHead>
              <TableHead className={cn(HEAD, "hidden sm:table-cell")}>{m["activity.col.channel"]}</TableHead>
              <TableHead className={HEAD}>{m["activity.col.status"]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-log-row={row.id}>
                <TableCell className={cn(CELL, "whitespace-nowrap font-medium tabular-nums")}>{formatCallTime(row.occurred_at, timezone)}</TableCell>
                <TableCell className={CELL}>{SOURCE_TITLES[row.source]}</TableCell>
                <TableCell className={cn(CELL, "hidden sm:table-cell")}>{row.contact_name ?? "—"}</TableCell>
                <TableCell className={cn(CELL, "hidden sm:table-cell text-muted-foreground")}>{CHANNEL_WORDS[row.channel]}</TableCell>
                <TableCell className={CELL}>
                  <LogStatusPill status={row.status} />
                  {row.status !== "sent" && row.reason ? (
                    <p className="mt-1 text-xs text-muted-foreground" data-log-reason>{row.reason}</p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListPanel>
      {olderHref || newerHref ? (
        <nav className="flex justify-end gap-2" aria-label="Pages">
          {newerHref ? <Link href={newerHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m["activity.newer"]}</Link> : null}
          {olderHref ? <Link href={olderHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m["activity.older"]}</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
