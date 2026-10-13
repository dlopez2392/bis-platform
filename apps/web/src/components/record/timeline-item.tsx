import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AuthorMark, type AuthorKind } from "./author-mark";

export type TimelineTone = "accent" | "good" | "warn" | "crit" | "muted";
const DOT: Record<TimelineTone, string> = {
  accent: "bg-[var(--accent)]", good: "bg-[var(--good)]", warn: "bg-[var(--warn)]",
  crit: "bg-[var(--crit)]", muted: "bg-[var(--text-3)]",
};

export type TimelineItemProps = {
  /** The row kind, for tests and styling hooks (`data-timeline-item`). */
  kind: string;
  icon: ComponentType<{ className?: string }>;
  mark: { kind: AuthorKind; label: string };
  /** S-03 part 2 (C8): the member a row is about, on a household's timeline; the mark after it
   *  still says who did it. */
  subject?: { label: string; href: string };
  verb: ReactNode;
  status?: { tone: TimelineTone; word: string } | null;
  detail?: string | null;
  time: string;
  dateTime: string;
  action?: ReactNode;
  children?: ReactNode;
};

const Sep = () => <span aria-hidden="true" className="text-muted-foreground">·</span>;

/**
 * One timeline row (spec §8, §9.4): who · did what · status · detail · when, then the body. Rows sit
 * on `--row-line` rules inside the card (never a box in a glass card); the caller draws the rule.
 */
export function TimelineItem({ kind, icon: Icon, mark, subject, verb, status, detail, time, dateTime, action, children }: TimelineItemProps) {
  return (
    <div data-timeline-item={kind} className="flex items-start gap-3 py-[7px]">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
          {subject ? (
            <>
              <Link href={subject.href} data-timeline-subject title={subject.label}
                className="max-w-[16rem] truncate rounded-[var(--radius-ctl)] font-medium text-card-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {subject.label}
              </Link>
              <Sep />
            </>
          ) : null}
          <AuthorMark kind={mark.kind} label={mark.label} />
          <span className="min-w-0 break-words font-medium text-card-foreground">{verb}</span>
          {status ? (
            <>
              <Sep />
              <span data-timeline-status={status.tone} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", DOT[status.tone])}></span><span>{status.word}</span>
              </span>
            </>
          ) : null}
          {detail ? (
            <>
              <Sep />
              <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
            </>
          ) : null}
          <Sep />
          <time dateTime={dateTime} className="text-xs text-muted-foreground tabular-nums">{time}</time>
        </p>
        {children ? <div className="mt-1 min-w-0">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Rule 7: the timeline's loading rows, shaped like a row (icon, mark chip, line, time). */
export function TimelineItemSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3" data-record-skeleton data-timeline-skeleton aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-timeline-skeleton-row className="flex items-start gap-3">
          <Skeleton className="size-4 shrink-0 rounded-[var(--radius-ctl)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className={cn("h-4 rounded-[var(--radius-ctl)]", i % 2 === 1 ? "w-1/3" : "w-1/2")} />
            </div>
            <Skeleton className="h-3 w-24 rounded-[var(--radius-ctl)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
