import Link from "next/link";
import type { AutomationLogListRow } from "@bis/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { ListPanel } from "@/components/ui/list-panel";
import { cn } from "@/lib/utils";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { reasonInLanguage } from "./reason-words";
import { sourceTitle, channelWord } from "@/lib/automations/log-titles";
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
  rows, timezone, olderHref, newerHref, locale = "en", pseudo = false,
}: {
  rows: AutomationLogListRow[];
  /** The ACCOUNT's zone, already resolved by the page. */
  timezone: string;
  olderHref?: string;
  newerHref?: string;
  /** S-10 T5: optional, default English — only activity/page.tsx passes it today. */
  locale?: Locale;
  pseudo?: boolean;
}) {
  const tr = makeTr(locale, pseudo);
  return (
    <div className="space-y-3">
      <ListPanel>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>{tr.text("activity.col.when")}</TableHead>
              <TableHead className={HEAD}>{tr.text("activity.col.what")}</TableHead>
              <TableHead className={cn(HEAD, "hidden sm:table-cell")}>{tr.text("activity.col.who")}</TableHead>
              <TableHead className={cn(HEAD, "hidden sm:table-cell")}>{tr.text("activity.col.channel")}</TableHead>
              <TableHead className={HEAD}>{tr.text("activity.col.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-log-row={row.id}>
                <TableCell className={cn(CELL, "whitespace-nowrap font-medium tabular-nums")}>{formatCallTime(row.occurred_at, timezone, locale)}</TableCell>
                <TableCell className={CELL}>{sourceTitle(row.source, locale)}</TableCell>
                <TableCell className={cn(CELL, "hidden sm:table-cell")}>{row.contact_name ?? "—"}</TableCell>
                <TableCell className={cn(CELL, "hidden sm:table-cell text-muted-foreground")}>{channelWord(row.channel, locale)}</TableCell>
                <TableCell className={CELL}>
                  <LogStatusPill status={row.status} locale={locale} pseudo={pseudo} />
                  {row.status !== "sent" && row.reason ? (
                    <p className="mt-1 text-xs text-muted-foreground" data-log-reason>{reasonInLanguage(row.reason, locale)}</p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListPanel>
      {olderHref || newerHref ? (
        <nav className="flex justify-end gap-2" aria-label={tr.text("activity.pagesLabel")}>
          {newerHref ? <Link href={newerHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{tr.text("activity.newer")}</Link> : null}
          {olderHref ? <Link href={olderHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{tr.text("activity.older")}</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
