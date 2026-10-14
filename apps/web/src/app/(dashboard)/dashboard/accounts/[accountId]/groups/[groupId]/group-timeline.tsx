import { CalendarCheck, CalendarClock, CheckSquare, DollarSign, FileText, Mail, MessageSquare, Paperclip, Phone, Square,
         StickyNote } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TimelineItem } from "@/components/record/timeline-item";
import { RecordCardRetry } from "@/components/record/record-card";
import { formatDateInZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { messageFailureReason } from "@/lib/email/failure-reason";
import { splitSummaryBlocks } from "@/lib/voice/summary-blocks";
import type { Locale } from "@/lib/i18n/locale";
import type { Tr } from "@/lib/record/copy";
import type { TimelineRow } from "@/lib/record/timeline-rows";
import { TIMELINE_ANCHOR } from "@/lib/record/timeline-pager";

export type GroupTimelineProps = {
  accountId: string;
  /** The account's RESOLVED zone (renderZone): a To-do's due date is midnight there (D-006). */
  timezone: string;
  /** One server page merged across the activity set, each row naming its member (`row.subject`). */
  rows: TimelineRow[];
  failedText: string | null;
  /** The empty state's sentence, set only on a first page with no rows and no failure. */
  emptyText: string | null;
  pager: { olderHref: string | null; newerHref: string | null };
  tr: Tr;
  /** S-09 §9: each member's language, by contact id; a member without one is absent. */
  customerLangs: Record<string, "en" | "es">;
};

/** A To-do's due date, in the SAME account zone it was saved from (D-006); no date rather than a throw. */
function dueText(dueAt: string, timezone: string, locale: Locale): string | null {
  try {
    return formatDateInZone(dueAt, timezone, locale);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

/**
 * The household's or business's timeline (S-03 part 2b, spec §8.8): the read-only twin of the contact
 * page's ActivityTimeline. Rows newest first under day separators in the account's zone, each
 * member · mark · verb · status · when (C8), then ONE pager. Nothing here writes (D5, C7): no
 * composer, no add-To-do, no Done, no hold hint and no assignee picker, because none of them is about
 * one person; each row's member links to the page where they are.
 */
export function GroupTimeline(p: GroupTimelineProps) {
  const { tr } = p;
  const pagerLink = cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8");
  return (
    <div id={TIMELINE_ANCHOR} className="scroll-mt-4 space-y-4">
      {p.failedText ? (
        // Some sources failed: the rows that loaded stay, and this says what could not. Try again
        // re-reads the current URL, so the same `?before=` page; the pager offers no Older.
        <div role="alert" data-timeline-failed className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-muted-foreground">{p.failedText}</p>
          <RecordCardRetry label={tr.text("record.card.retry")} />
        </div>
      ) : null}

      {p.emptyText ? <p data-timeline-empty className="text-sm text-muted-foreground">{p.emptyText}</p> : null}

      {p.rows.length > 0 ? (
        <ol className="flex flex-col">
          {p.rows.map((row, i) => (
            <li key={row.key}
              // A day separator is already a divider; a row rule directly above one would read as two lines.
              className={cn("border-t border-[var(--row-line)] first:border-t-0", row.showDay && "border-t-0")}>
              {row.showDay ? (
                <div className={cn("mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground", i > 0 && "mt-3")}>
                  <Separator className="flex-1" />
                  {row.day}
                  <Separator className="flex-1" />
                </div>
              ) : null}
              <Row row={row} timezone={p.timezone} accountId={p.accountId} tr={tr} customerLangs={p.customerLangs} />
            </li>
          ))}
        </ol>
      ) : null}

      {p.pager.olderHref || p.pager.newerHref ? (
        <nav aria-label={tr.text("timeline.pages")} data-timeline-pager className="flex items-center justify-end gap-2">
          {p.pager.newerHref ? <Link href={p.pager.newerHref} className={pagerLink}>{tr.text("timeline.newer")}</Link> : null}
          {p.pager.olderHref ? <Link href={p.pager.olderHref} className={pagerLink}>{tr.text("timeline.older")}</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}

function Row({ row, timezone, accountId, tr, customerLangs }: {
  row: TimelineRow; timezone: string; accountId: string; tr: Tr; customerLangs: Record<string, "en" | "es">;
}) {
  const e = row.entry;
  const customerLang = customerLangs[e.contactId] ?? "";
  const head = {
    kind: e.kind, mark: row.mark, subject: row.subject ?? undefined, verb: row.verb, status: row.status,
    detail: row.detail, time: row.time, dateTime: e.at,
  };
  switch (e.kind) {
    case "note":
      return (
        <TimelineItem {...head} icon={StickyNote}>
          <p lang="" className="whitespace-pre-wrap break-words text-sm text-card-foreground">{e.note.body}</p>
        </TimelineItem>
      );
    case "task": {
      const done = Boolean(e.task.completed_at);
      const due = e.task.due_at ? dueText(e.task.due_at, timezone, tr.locale) : null;
      return (
        <TimelineItem {...head} icon={done ? CheckSquare : Square}>
          <p lang="" className={cn("text-sm", done ? "text-muted-foreground line-through" : "text-card-foreground")}>{e.task.title}</p>
          {due ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden />{due}</span>
            </div>
          ) : null}
        </TimelineItem>
      );
    }
    case "deal":
      return <TimelineItem {...head} icon={DollarSign} />;
    // S-07: a file added to the record; FileText is the form submission's, so a file wears the paperclip.
    case "document":
      return <TimelineItem {...head} icon={Paperclip} />;
    // S-07 1b: a new version of a file wears the file's paperclip.
    case "documentVersion":
      return <TimelineItem {...head} icon={Paperclip} />;
    case "submission": {
      const answers = e.submission.answers.filter((a) => a.value);
      return (
        <TimelineItem {...head} icon={FileText}>
          {answers.length > 0 ? (
            <dl className="space-y-0.5">
              {answers.map((a) => (
                <div key={a.key} className="flex gap-2 text-sm">
                  <dt className="shrink-0 text-muted-foreground">{a.label}:</dt>
                  <dd lang={e.submission.author_kind === "customer" ? customerLang : ""} className="min-w-0 break-words text-card-foreground">{a.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </TimelineItem>
      );
    }
    case "message": {
      const reason = e.message.direction === "outbound" ? messageFailureReason(e.message, tr.locale) : null;
      // S-09 §9: an inbound message is what the customer typed. The timeline loads only email and sms
      // (record.ts's listContactMessages `channels`), so the AI's `voice` summary never reaches here.
      const typedLang = e.message.direction === "inbound" ? customerLang : "";
      return (
        <TimelineItem {...head} icon={e.message.channel === "sms" ? MessageSquare : Mail}>
          {e.message.subject ? <p lang={typedLang} className="text-sm font-medium text-card-foreground">{e.message.subject}</p> : null}
          <p lang={typedLang} className="whitespace-pre-wrap break-words text-sm text-card-foreground">{e.message.body}</p>
          {reason ? <p className="mt-1 text-xs text-[var(--crit)]">{reason}</p> : null}
        </TimelineItem>
      );
    }
    case "booking":
      return (
        <TimelineItem {...head} icon={CalendarCheck}>
          {e.booking.note ? <p lang={e.booking.author_kind === "customer" ? customerLang : ""} className="whitespace-pre-wrap break-words text-sm text-card-foreground">{e.booking.note}</p> : null}
        </TimelineItem>
      );
    case "call": {
      // As ActivityTimeline's call row (minors-1b item 5): the reason as typed (lang=""), else only the
      // summary's English prose, and nothing at all when the summary carries a MISMATCH warning.
      const reason = e.call.reason?.trim() || null;
      const blocks = reason ? [] : splitSummaryBlocks(e.call.summary);
      const prose = blocks.some((b) => b.kind === "mismatch")
        ? null
        : blocks.filter((b) => b.kind === "prose").map((b) => b.text).join(" ") || null;
      const words = reason || prose;
      return (
        <TimelineItem {...head} icon={Phone} action={
          <Link href={`/dashboard/accounts/${accountId}/calls/${e.id}`} data-timeline-open-call
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>{tr.text("timeline.openCall")}</Link>
        }>
          {words ? <p lang={reason ? "" : "en"} className="line-clamp-2 break-words text-sm text-card-foreground">{words}</p> : null}
        </TimelineItem>
      );
    }
  }
}
