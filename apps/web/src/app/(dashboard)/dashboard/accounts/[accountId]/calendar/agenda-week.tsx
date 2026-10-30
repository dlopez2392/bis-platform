"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { AgendaRow, ClosedHead, onAgendaListKeys, type AgendaWords } from "./agenda-day";
import type { AgendaDayView } from "./agenda-view";

/**
 * F-046 part 1 (plan Task 12, spec 5.3): Week. On a desk, seven columns, Sunday first (D10), each a compact Day
 * list with no free rows and no cancelled rows (D11), its head a link to that Day. Below `md`, one day at a
 * time (the URL's own `day`) under a strip of seven day links, so the phone's Week is a Day list for the chosen
 * day and the browser's Back walks the same days. All links: the page is server-rendered from the URL.
 */
export function AgendaWeek({ days, selected, words, weekHref }: {
  days: AgendaDayView[]; selected: string; words: AgendaWords;
  /** The strip's link for a day of this week: `?view=week&day=<key>`. */
  weekHref: Readonly<Record<string, string>>;
}) {
  // A job past midnight is in two columns; its anchor id goes on ONE copy: the chosen day's when the job is on
  // it (the phone shows only that column), else the first column it is in (T11/T12 review minor).
  const anchorDay = new Map<string, string>();
  for (const d of days) for (const r of d.rows) if (!anchorDay.has(r.id) || d.key === selected) anchorDay.set(r.id, d.key);
  const LINK = "inline-flex min-h-11 items-center justify-center rounded-[var(--radius-ctl)] px-2 text-sm outline-none "
    + "transition-colors duration-150 hover:bg-[var(--surface-3)] focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8";
  return (
    <div data-agenda-week className="space-y-3">
      <nav aria-label={words.daysLabel} className="grid grid-cols-7 gap-1 md:hidden">
        {days.map((d) => (
          <Link
            key={d.key}
            href={weekHref[d.key] ?? d.href}
            scroll={false}
            aria-current={d.key === selected ? "date" : undefined}
            className={cn(LINK, "min-w-0 flex-col break-words px-0 text-xs tabular-nums", d.key === selected && "bg-[var(--accent-dim)] font-medium text-foreground")}
          >
            {d.short}
          </Link>
        ))}
      </nav>
      <div className="md:grid md:grid-cols-7 md:gap-2">
        {days.map((d) => (
          <section key={d.key} data-agenda-column={d.key} aria-label={d.heading} className={cn("min-w-0 space-y-2", d.key === selected ? "block" : "hidden md:block")}>
            <Link href={d.href} className={cn(LINK, "w-full justify-start font-medium tabular-nums")}>
              <span className="md:hidden">{d.heading}</span>
              <span className="hidden md:inline">{d.short}</span>
            </Link>
            {d.closed ? <ClosedHead words={d.closed} /> : null}
            <div data-agenda-list onKeyDown={onAgendaListKeys} className="space-y-2">
              {[...d.rows].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).map((r) => (
                <AgendaRow key={r.id} row={r} words={words} compact anchor={anchorDay.get(r.id) === d.key} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
