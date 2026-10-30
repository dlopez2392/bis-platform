"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { BookingMeetingType, BookingStatus } from "@bis/db";
import { Button } from "@/components/ui/button";
import { DotPill } from "@/components/dot-pill";
import { cn } from "@/lib/utils";
import { CONFIRM_REPLY_TREATMENTS } from "./confirm-reply";
import { JobSheet } from "./job-sheet";
import type { AgendaDayView, AgendaFreeRow, AgendaRowView } from "./agenda-view";

/**
 * F-046 part 1 (plan Task 12, spec 5.2, 5.6): the Day list. Every word arrives made (agenda-view.ts); this file
 * only lays it out. A row is the whole button that opens the drawer (rule 4: `--surface-2` row inside the
 * `--surface-1` card, `--surface-3` hover, a visible `:focus-visible` ring), `id="booking-<id>"` so the drawer's
 * Esc returns focus to it; Up and Down move between rows; a free hour opens the Add job sheet prefilled.
 * Overlaps and Closed are dot and word on `--warn` and `--crit` (rule 3; the only two places those hues are used).
 */

/** What the Add job sheet needs beyond its prefill: the props every sheet on this card shares. */
export type AgendaSheetContext = {
  accountId: string; timezone: string; locale: "en" | "es"; calendarMeetingType: BookingMeetingType; defaultMinutes: number;
  /** The QA pseudo-locale, so the Add job sheet pads its words as the card does (design review C1). */
  pseudo: boolean;
};
export type AgendaWords = { overlaps: string; outsideHours: string; daysLabel: string };

const STATUS_TREATMENT: Record<BookingStatus, { chip: string; dot: string }> = {
  booked: { chip: "border-border bg-transparent text-foreground", dot: "bg-[var(--accent)]" },
  completed: { chip: "border-border bg-transparent text-foreground", dot: "bg-[var(--good)]" },
  no_show: { chip: "border-border bg-transparent text-muted-foreground", dot: "bg-[var(--text-3)]" },
  cancelled: { chip: "border-border bg-transparent text-muted-foreground", dot: "bg-[var(--text-3)]" },
};
export const OVERLAP_TREATMENT = { chip: "border-transparent bg-[var(--warn-bg)] text-foreground", dot: "bg-[var(--warn)]" };
export const CLOSED_TREATMENT = { chip: "border-transparent bg-[var(--crit-bg)] text-foreground", dot: "bg-[var(--crit)]" };
const OUTSIDE_TREATMENT = { chip: "border-border bg-transparent text-muted-foreground", dot: "bg-[var(--text-3)]" };

const ROW = "block w-full rounded-[var(--radius-ctl)] text-left outline-none transition-colors duration-150 "
  + "hover:bg-[var(--surface-3)] focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none";

/** Up and Down move focus between the rows of the list this handler sits on (spec 5.6). */
export function onAgendaListKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const nav = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-agenda-nav]")];
  const at = nav.indexOf(e.target as HTMLElement);
  if (at < 0) return;
  const next = nav[at + (e.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

export function ClosedHead({ words }: { words: string }) {
  return <DotPill data-agenda-closed label={words} {...CLOSED_TREATMENT} />;
}

/** One job. `compact` is the Week column's: the time and name, then the tags. `anchor`: whether this copy carries
 *  the row's `id="booking-<id>"` (Week draws a job past midnight in two columns; an id is ONE element's). */
export function AgendaRow({ row, words, compact = false, anchor = true }: { row: AgendaRowView; words: AgendaWords; compact?: boolean; anchor?: boolean }) {
  const router = useRouter();
  const details = [row.address, row.meetingWord, row.madeBy].filter(Boolean).join(" · ");
  return (
    <button
      id={anchor ? `booking-${row.id}` : undefined}
      type="button"
      data-agenda-nav
      data-agenda-row={row.status}
      onClick={() => router.push(row.href, { scroll: false })}
      className={cn(ROW, "bg-[var(--surface-2)] px-3 py-2.5", !row.live && "text-muted-foreground")}
    >
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium tabular-nums">{row.startLabel} – {row.endLabel}</span>
        <span className={cn("min-w-0 break-words font-medium", row.live && "text-foreground")}>{row.customer}</span>
      </span>
      {!compact && row.what ? <span className="mt-0.5 block break-words text-sm">{row.what}</span> : null}
      {!compact && details ? <span className="mt-0.5 block break-words text-xs text-muted-foreground">{details}</span> : null}
      <span className="mt-1.5 flex flex-wrap gap-1.5">
        <DotPill dense label={row.statusWord} {...STATUS_TREATMENT[row.status]} />
        {row.confirmReply && row.confirmWord ? (
          <DotPill dense label={row.confirmWord} chip={CONFIRM_REPLY_TREATMENTS[row.confirmReply].chip} dot={CONFIRM_REPLY_TREATMENTS[row.confirmReply].dot} />
        ) : null}
        {row.overlaps ? <DotPill dense data-agenda-overlaps label={words.overlaps} {...OVERLAP_TREATMENT} /> : null}
        {row.outsideHours ? <DotPill dense data-agenda-outside label={words.outsideHours} {...OUTSIDE_TREATMENT} /> : null}
      </span>
    </button>
  );
}

/** The card's one primary (rule 8), and the empty state's ghost twin; each opens its own Add job sheet. */
export function AddJobButton({ label, sheet, prefill, variant = "default" }: {
  label: string; sheet: AgendaSheetContext; prefill: { date: string; start: string }; variant?: "default" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} className="min-h-11 md:min-h-9" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {label}
      </Button>
      <JobSheet
        {...sheet} mode="add" open={open} onOpenChange={setOpen}
        prefill={{ ...prefill, minutes: sheet.defaultMinutes, meetingType: sheet.calendarMeetingType }}
      />
    </>
  );
}

type Entry =
  | { t: number; order: 0; kind: "item"; item: AgendaDayView["lanes"][number] }
  | { t: number; order: 1; kind: "cancelled"; row: AgendaRowView }
  | { t: number; order: 2; kind: "free"; free: AgendaFreeRow };

export function AgendaDay({ day, words, sheet }: { day: AgendaDayView; words: AgendaWords; sheet: AgendaSheetContext }) {
  const [prefill, setPrefill] = useState<{ date: string; start: string } | null>(null);
  const byId = new Map(day.rows.map((r) => [r.id, r]));
  const startOf = (id: string) => Date.parse(byId.get(id)?.startsAt ?? "");
  const entries: Entry[] = [
    ...day.lanes.map((item): Entry => ({
      t: Math.min(...(item.kind === "single" ? [item.id] : item.kind === "side" ? item.lanes.flat() : item.ids).map(startOf)),
      order: 0, kind: "item", item,
    })),
    ...day.cancelled.map((row): Entry => ({ t: Date.parse(row.startsAt), order: 1, kind: "cancelled", row })),
    ...day.free.map((free): Entry => ({ t: Date.parse(free.at), order: 2, kind: "free", free })),
  ].sort((a, b) => a.t - b.t || a.order - b.order);
  const rowOf = (id: string) => {
    const r = byId.get(id);
    return r ? <AgendaRow key={id} row={r} words={words} /> : null;
  };

  return (
    <div data-agenda-day={day.key} className="space-y-2">
      {day.closed ? <ClosedHead words={day.closed} /> : null}
      <div data-agenda-list onKeyDown={onAgendaListKeys} className="space-y-2">
        {entries.map((e) => {
          if (e.kind === "cancelled") return <AgendaRow key={e.row.id} row={e.row} words={words} />;
          if (e.kind === "free") {
            return (
              <button
                key={e.free.at}
                type="button"
                data-agenda-nav
                data-agenda-free
                onClick={() => setPrefill({ date: day.key, start: e.free.start })}
                className={cn(ROW, "flex items-center gap-2 border border-dashed border-[var(--line)] px-3 py-1.5 text-sm text-muted-foreground")}
              >
                <Plus aria-hidden className="size-4 shrink-0" />
                <span className="tabular-nums">{e.free.label}</span>
              </button>
            );
          }
          const { item } = e;
          if (item.kind === "single") return rowOf(item.id);
          if (item.kind === "side") {
            return (
              <div key={item.lanes.flat().join(",")} data-agenda-side className="grid gap-2 sm:grid-cols-2">
                {item.lanes.map((lane, i) => <div key={i} className="min-w-0 space-y-2">{lane.map(rowOf)}</div>)}
              </div>
            );
          }
          return <div key={item.ids.join(",")} data-agenda-stack className="space-y-2">{item.ids.map(rowOf)}</div>;
        })}
      </div>
      {day.free.length > 0 ? (
        <JobSheet
          {...sheet} mode="add" open={prefill !== null} onOpenChange={(open) => { if (!open) setPrefill(null); }}
          prefill={{ date: prefill?.date ?? day.key, start: prefill?.start ?? day.free[0]!.start, minutes: sheet.defaultMinutes, meetingType: sheet.calendarMeetingType }}
        />
      ) : null}
    </div>
  );
}
