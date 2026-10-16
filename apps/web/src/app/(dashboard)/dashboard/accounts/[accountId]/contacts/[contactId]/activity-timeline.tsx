import { CalendarCheck, CalendarClock, CheckSquare, DollarSign, FileText, Mail, MessageSquare, Paperclip, Phone, Send, ShieldAlert, Square,
         StickyNote } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SmsGate } from "@/lib/sms/sender";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TimelineItem } from "@/components/record/timeline-item";
import { RecordCardRetry } from "@/components/record/record-card";
import { TaskAssigneeField } from "@/components/assign/assignee-field";
import { formatDateInZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { messageFailureReason } from "@/lib/email/failure-reason";
import { splitSummaryBlocks } from "@/lib/voice/summary-blocks";
import type { AssignMember } from "@/lib/assign/view";
import type { Locale } from "@/lib/i18n/locale";
import type { Tr } from "@/lib/record/copy";
import type { TimelineRow } from "@/lib/record/timeline-rows";
import { TIMELINE_ANCHOR } from "@/lib/record/timeline-pager";
import { addNoteAction, addTaskAction, completeTaskAction } from "./actions";
import { MessageComposer } from "./message-composer";
import { ADD_TODO_FIELD_ID } from "./constants";

export type ActivityTimelineProps = {
  accountId: string;
  contactId: string;
  contactHasEmail: boolean;
  /** Whether e164Of(contact.phone) resolves: the same notion sendSmsAction gates on. */
  contactHasPhone: boolean;
  /** THE send gate, resolved on the server (resolveSmsSender); null = could not be read. */
  smsGate: SmsGate | null;
  /** The recipient's consent line (lib/consent/composer-state.ts), in the page's language; null when it may text. */
  smsBlockedLine: string | null;
  emailNoticeLine: string | null;
  emailAction: (formData: FormData) => Promise<void>;
  smsAction: (formData: FormData) => Promise<void>;
  /** The account's RESOLVED zone (renderZone): a To-do's due date is midnight there (D-006). */
  timezone: string;
  /** F-085 part 1: may this caller hand tasks on, and to whom. */
  canAssign?: boolean;
  members?: AssignMember[];
  /** S-03 1b: one server page, merged across seven sources, already in the page's language. */
  rows: TimelineRow[];
  /** Open To-dos whose number is still on hold (consent chain PR-2, G21): a hint stands in for Done. */
  holdOpenTaskIds: string[];
  /** "Couldn't load calls and bookings." when some sources failed; null otherwise. */
  failedText: string | null;
  /** The empty state's sentence, set only on a first page with no rows and no failure. */
  emptyText: string | null;
  pager: { olderHref: string | null; newerHref: string | null };
  tr: Tr;
  /** S-09 §9: the contact's language for what the CUSTOMER typed; "" when not set (C10). */
  customerLang: "" | "en" | "es";
};

/** A To-do's due date, in the SAME account zone it was saved from (D-006); no date rather than a throw. */
function taskDueDateText(dueAt: string, timezone: string, locale: Locale): string | null {
  try {
    return formatDateInZone(dueAt, timezone, locale);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

/**
 * The record page's timeline (S-03 part 1, spec §9.4), inside its RecordCard ("Activity"): the
 * composer first (where the header's Text and Email land), the add-To-do row, then one server page
 * of rows under day separators in the account's zone, each row who · did what · when on the kit's
 * TimelineItem, then ONE pager. Every row carries an author mark (DESIGN.md, Provenance).
 */
export function ActivityTimeline(p: ActivityTimelineProps) {
  const { tr } = p;
  const hidden = <input type="hidden" name="contactId" value={p.contactId} />;
  const assign = p.canAssign ? { accountId: p.accountId, members: p.members ?? [] } : null;
  const boundAddTask = addTaskAction.bind(null, p.accountId);
  const boundAddNote = addNoteAction.bind(null, p.accountId);
  const boundCompleteTask = completeTaskAction.bind(null, p.accountId);
  const pagerLink = cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8");

  return (
    <div id={TIMELINE_ANCHOR} className="scroll-mt-4 space-y-4">
      <div className="border-b border-[var(--row-line)] pb-4" data-timeline-composer>
        <MessageComposer contactId={p.contactId} contactHasEmail={p.contactHasEmail} contactHasPhone={p.contactHasPhone}
          smsGate={p.smsGate} smsBlockedLine={p.smsBlockedLine} emailNoticeLine={p.emailNoticeLine}
          noteAction={boundAddNote} emailAction={p.emailAction} smsAction={p.smsAction} />
      </div>
      <form action={boundAddTask} aria-label={tr.text("contact.tasks")}
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-[var(--line-strong)] p-2">
        {hidden}
        <Input id={ADD_TODO_FIELD_ID} name="title" placeholder={tr.text("contact.addTask")}
          className="h-8 min-w-[140px] min-h-11 flex-1 text-sm md:min-h-8" />
        <Input name="dueAt" type="date" className="h-8 w-36 min-h-11 text-sm md:min-h-8" />
        <Button type="submit" variant="outline" size="sm" className="min-h-11 md:min-h-8">{tr.text("common.add")}</Button>
      </form>

      {p.failedText ? (
        // Some sources failed (spec §9.4): the rows that loaded stay, and this says what could not.
        // Try again re-reads the current URL, so the same `?before=` page; the pager offers no Older.
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
              <Row row={row} hidden={hidden} completeAction={boundCompleteTask} timezone={p.timezone} assign={assign}
                holdOpen={p.holdOpenTaskIds} accountId={p.accountId} tr={tr} customerLang={p.customerLang} />
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

function Row({ row, hidden, completeAction, timezone, assign, holdOpen, accountId, tr, customerLang }: {
  row: TimelineRow; hidden: ReactNode; completeAction: (formData: FormData) => Promise<void>; timezone: string;
  assign: { accountId: string; members: AssignMember[] } | null; holdOpen: string[]; accountId: string; tr: Tr;
  customerLang: "" | "en" | "es";
}) {
  const e = row.entry;
  const head = { kind: e.kind, mark: row.mark, verb: row.verb, status: row.status, detail: row.detail, time: row.time, dateTime: e.at };
  switch (e.kind) {
    case "note":
      return (
        <TimelineItem {...head} icon={StickyNote}>
          <p lang="" className="whitespace-pre-wrap break-words text-sm text-card-foreground">{e.note.body}</p>
        </TimelineItem>
      );
    case "task": {
      const done = Boolean(e.task.completed_at);
      const due = e.task.due_at ? taskDueDateText(e.task.due_at, timezone, tr.locale) : null;
      const action = done ? null : holdOpen.includes(e.id) ? (
        <p className="text-xs text-muted-foreground" data-testid="task-decide-first">{tr.text("todo.consent.timelineHint")}</p>
      ) : (
        <form action={completeAction}>
          {hidden}
          <input type="hidden" name="taskId" value={e.id} />
          <Button type="submit" variant="outline" size="xs" className="min-h-11 md:min-h-8">{tr.text("contact.done")}</Button>
        </form>
      );
      return (
        <TimelineItem {...head} icon={done ? CheckSquare : Square} action={action}>
          <p lang="" className={cn("text-sm", done ? "text-muted-foreground line-through" : "text-card-foreground")}>{e.task.title}</p>
          {due || (assign && !done) ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {due ? <span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden />{due}</span> : null}
              {assign && !done ? (
                <TaskAssigneeField key={`${e.id}:${e.task.assigned_to ?? ""}`} accountId={assign.accountId} taskId={e.id}
                  value={e.task.assigned_to} options={assign.members} />
              ) : null}
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
    // S-07 2a: a removed file wears a shield (the row's own crit dot and word carry the state).
    case "documentRemoved":
      return <TimelineItem {...head} icon={ShieldAlert} />;
    // S-07 2b: a request for files wears the send arrow (the link went out to the customer).
    case "documentRequest":
      return <TimelineItem {...head} icon={Send} />;
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
      // calls.summary is always English (owner decision A, summary-service.ts)
      // and calls.reason is staff-facing too, but from either an English
      // post-call reading or a taken-message body whose language is not
      // known here — so reason is lang="" (unknown), never the caller's
      // own language (that is calls.caller_words, shown on the call card,
      // not here; C11).
      const reason = e.call.reason?.trim() || null;
      // calls.summary is composeSummary's own shape (lib/voice/summarize.ts): the
      // system's fact line, an optional ⚠ MISMATCH warning, then the model's prose
      // — never the whole string verbatim. Falling back to it here (no reason)
      // shows only the prose: the fact line is internal bookkeeping a customer's
      // own row should never carry, and a MISMATCH means the prose is contradicted
      // by what was actually recorded, so NOTHING is shown rather than a claim this
      // row cannot stand behind — the row still keeps its verb, status and Open
      // call link either way (minors-1b item 5).
      const blocks = reason ? [] : splitSummaryBlocks(e.call.summary);
      const prose = blocks.some((b) => b.kind === "mismatch")
        ? null
        : blocks.filter((b) => b.kind === "prose").map((b) => b.text).join(" ") || null;
      const words = reason || prose;
      const lang = reason ? "" : "en";
      return (
        <TimelineItem {...head} icon={Phone} action={
          <Link href={`/dashboard/accounts/${accountId}/calls/${e.id}`} data-timeline-open-call
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>{tr.text("timeline.openCall")}</Link>
        }>
          {words ? <p lang={lang} className="line-clamp-2 break-words text-sm text-card-foreground">{words}</p> : null}
        </TimelineItem>
      );
    }
  }
}
