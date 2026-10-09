import { CalendarClock, CheckSquare, DollarSign, FileText, History, Mail, MessageSquare, Phone,
         Square, StickyNote } from "lucide-react";
import type { ComponentType } from "react";
import type { listNotes, listContactTasks, listContactOpportunities, listContactSubmissions,
              listContactMessages, NewMessage } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatDateInZone, formatDateTimeInZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { STATUS_LABEL, MESSAGE_STATUS_LABEL, messageChannelLabel } from "@/lib/labels";
import { messageFailureReason } from "@/lib/email/failure-reason";

// Exhaustively typed to the real channel union (see labels.ts's own
// MESSAGE_CHANNEL_LABEL comment) so a new channel is a compile error here
// too, not a silent fallback to the Mail icon.
const MESSAGE_CHANNEL_ICON: Record<NewMessage["channel"], ComponentType<{ className?: string }>> = {
  email: Mail,
  sms: MessageSquare,
  voice: Phone,
  form: FileText,
};
import { addNoteAction, addTaskAction, completeTaskAction } from "./actions";
import { MessageComposer } from "./message-composer";

type Note = Awaited<ReturnType<typeof listNotes>>[number];
type Task = Awaited<ReturnType<typeof listContactTasks>>[number];
type Opportunity = Awaited<ReturnType<typeof listContactOpportunities>>[number];
type Submission = Awaited<ReturnType<typeof listContactSubmissions>>[number];
type ContactMessage = Awaited<ReturnType<typeof listContactMessages>>[number];

type TimelineItem =
  | { kind: "note"; id: string; at: string; body: string }
  | { kind: "task"; id: string; at: string; title: string; dueAt: string | null; completedAt: string | null; holdOpen: boolean }
  | { kind: "opportunity"; id: string; at: string; name: string; value: number; status: string }
  | { kind: "submission"; id: string; at: string; formName: string;
      answers: { key: string; label: string; value: string }[] }
  | { kind: "message"; id: string; at: string; direction: string; subject: string | null;
      body: string; status: string; channel: string; error: string | null };

export function ActivityTimeline({
  accountId,
  contactId,
  contactHasEmail,
  contactHasPhone,
  smsGate,
  smsBlockedLine,
  emailNoticeLine,
  notes,
  tasks,
  holdOpenTaskIds,
  opportunities,
  submissions,
  messages,
  emailAction,
  smsAction,
  timezone,
}: {
  accountId: string;
  contactId: string;
  contactHasEmail: boolean;
  // Mirrors contactHasEmail: whether toE164(contact.phone) resolves to a
  // usable number (same notion sendSmsAction itself gates on).
  contactHasPhone: boolean;
  // Resolved server-side (resolveSmsSender, THE gate) and threaded through as
  // a plain prop — MessageComposer is a client component and must not query
  // the database itself.
  smsGate: SmsGate;
  /** Consent chain spec §6: the one line the Text tab shows in place of the
   *  form when the recipient's texts are stopped, held or the number is
   *  unconfirmed (lib/consent/composer-state.ts); null when it may text. */
  smsBlockedLine: string | null;
  /** The email composer's notice, decided on the server (consent PR-3). */
  emailNoticeLine: string | null;
  notes: Note[];
  tasks: Task[];
  /** Open To-dos whose number is still on hold (consent chain PR-2, G21):
   *  decided with Confirm stop / Not a stop, so a hint stands in for Done. */
  holdOpenTaskIds: string[];
  opportunities: Opportunity[];
  submissions: Submission[];
  /** Every message exchanged with this contact. Before these were passed, an
   *  email sent from THIS page appeared only in Conversations — the record it
   *  was sent from showed nothing. */
  messages: ContactMessage[];
  emailAction: (formData: FormData) => Promise<void>;
  smsAction: (formData: FormData) => Promise<void>;
  /** The account's RESOLVED zone (`renderZone`, already computed by this
   *  page for the Texts/Email rows' own dates) — review finding: a task's
   *  due date is now saved as midnight in the ACCOUNT's own zone (D-006,
   *  actions.ts's `dueAtInAccountZone`), and this card used to render it
   *  with `formatDateUTC` — correct for a zone WEST of UTC (where that
   *  instant's UTC calendar day still matches), wrong for one EAST of it
   *  (Berlin, Tokyo: midnight there is already the PREVIOUS day in UTC), so
   *  the To do screen and this card could disagree about which day a task
   *  was due. `formatDateInZone` with the SAME zone the instant was built
   *  from always round-trips to the same day, in any zone. */
  timezone: string;
}) {
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  const boundAddTask = addTaskAction.bind(null, accountId);
  const boundAddNote = addNoteAction.bind(null, accountId);
  const boundCompleteTask = completeTaskAction.bind(null, accountId);

  const items: TimelineItem[] = [
    ...notes.map((n): TimelineItem => ({ kind: "note", id: n.id, at: n.created_at, body: n.body })),
    ...tasks.map(
      (t): TimelineItem => ({
        kind: "task",
        id: t.id,
        at: t.created_at,
        title: t.title,
        dueAt: t.due_at,
        completedAt: t.completed_at,
        holdOpen: holdOpenTaskIds.includes(t.id),
      }),
    ),
    ...opportunities.map(
      (o): TimelineItem => ({
        kind: "opportunity",
        id: o.id,
        at: o.created_at,
        name: o.name,
        value: Number(o.monetary_value),
        status: o.status,
      }),
    ),
    ...submissions.map(
      (s): TimelineItem => ({
        kind: "submission",
        id: s.id,
        at: s.created_at,
        formName: s.formName,
        answers: s.answers.filter((a) => a.value),
      }),
    ),
    ...messages.map(
      (msg): TimelineItem => ({
        kind: "message",
        id: msg.id,
        at: msg.created_at,
        direction: msg.direction,
        subject: msg.subject,
        body: msg.body,
        status: msg.status,
        channel: msg.channel,
        error: msg.error,
      }),
    ),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));


  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">{m["contact.activity"]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          action={boundAddTask}
          aria-label={m["contact.tasks"]}
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-[var(--line-strong)] p-2"
        >
          {hidden}
          <Input
            name="title"
            placeholder={m["contact.addTask"]}
            className="h-8 min-w-[140px] flex-1 text-sm"
          />
          <Input name="dueAt" type="date" className="h-8 w-36 text-sm" />
          <Button type="submit" variant="outline" size="sm">
            {m["common.add"]}
          </Button>
        </form>

        {items.length === 0 ? (
          <EmptyState
            icon={History}
            title={m["contact.noActivity"]}
            body={m["contact.noActivityBody"]}
          />
        ) : (
          /* These were five stacked, bordered, card-filled boxes INSIDE a
             glass `<Card>` — five card shadows piling up on one, and a
             nested-card shape the ladder forbids. They are timeline ROWS:
             the panel is the card, the rows are `--row-line` rules (the
             mockup's `.row`, northern-lights.html:122). */
          <ol className="flex flex-col">
            {items.map((item, i) => {
              // D-010: the account's own zone, not the runtime's (server or
              // browser) — the same bug `taskDueDateText` below already
              // fixed for a task's due date, now applied to every row's own
              // "when this happened" timestamp and the day it groups under.
              const day = formatDateInZone(item.at, timezone);
              // Derive the separator from the previous item rather than a
              // carried variable — mutating during render is not safe.
              const showSeparator = i === 0 || day !== formatDateInZone(items[i - 1]!.at, timezone);
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  // A day separator is already a divider; a row rule directly
                  // above one would read as two lines.
                  className={cn(
                    "border-t border-[var(--row-line)] first:border-t-0",
                    showSeparator && "border-t-0",
                  )}
                >
                  {showSeparator ? (
                    <div
                      className={cn(
                        "mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground",
                        i > 0 && "mt-3",
                      )}
                    >
                      <Separator className="flex-1" />
                      {day}
                      <Separator className="flex-1" />
                    </div>
                  ) : null}
                  <TimelineRow item={item} hidden={hidden} completeAction={boundCompleteTask} timezone={timezone} />
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
      <CardFooter className="border-t border-border pt-4">
        <MessageComposer
          contactId={contactId}
          contactHasEmail={contactHasEmail}
          contactHasPhone={contactHasPhone}
          smsGate={smsGate}
          smsBlockedLine={smsBlockedLine}
          emailNoticeLine={emailNoticeLine}
          noteAction={boundAddNote}
          emailAction={emailAction}
          smsAction={smsAction}
        />
      </CardFooter>
    </Card>
  );
}

/** A task's own due date, in the SAME account zone it was saved from
 *  (D-006's `dueAtInAccountZone`) — never UTC, which reads as the previous
 *  day for any zone east of it. Degrades to no date rather than throwing on
 *  a genuinely unparseable stored value, matching `tasks/work-list.tsx`'s
 *  own `rowDateText`: a bad date must not take the whole card down with
 *  it. `timezone` itself is never the cause of a throw here — it is
 *  `renderZone`'s resolved zone, total by construction. */
function taskDueDateText(dueAt: string, timezone: string): string | null {
  try {
    return formatDateInZone(dueAt, timezone);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

function TimelineRow({
  item,
  hidden,
  completeAction,
  timezone,
}: {
  item: TimelineItem;
  hidden: React.ReactNode;
  completeAction: (formData: FormData) => Promise<void>;
  timezone: string;
}) {
  if (item.kind === "note") {
    return (
      <div className="flex gap-3 py-[7px]">
        <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-sm text-card-foreground">{item.body}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTimeInZone(item.at, timezone)}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "task") {
    const done = Boolean(item.completedAt);
    const Icon = done ? CheckSquare : Square;
    return (
      <div className="flex items-start gap-3 py-[7px]">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm", done ? "text-muted-foreground line-through" : "text-card-foreground")}>
            {item.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDateTimeInZone(item.at, timezone)}</span>
            {item.dueAt && taskDueDateText(item.dueAt, timezone) ? (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3" aria-hidden />
                {taskDueDateText(item.dueAt, timezone)}
              </span>
            ) : null}
          </div>
        </div>
        {!done && item.holdOpen ? (
          <p className="shrink-0 text-xs text-muted-foreground" data-testid="task-decide-first">
            {m["todo.consent.timelineHint"]}
          </p>
        ) : !done ? (
          <form action={completeAction} className="shrink-0">
            {hidden}
            <input type="hidden" name="taskId" value={item.id} />
            <Button type="submit" variant="outline" size="xs">
              {m["contact.done"]}
            </Button>
          </form>
        ) : null}
      </div>
    );
  }

  if (item.kind === "message") {
    const outbound = item.direction === "outbound";
    const Icon = MESSAGE_CHANNEL_ICON[item.channel as NewMessage["channel"]] ?? Mail;
    const channelLabel = messageChannelLabel(item.channel);
    return (
      <div className="flex gap-3 py-[7px]">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-card-foreground">
            {(outbound ? m["contact.activitySent"] : m["contact.activityReceived"])
              .replace("{channel}", channelLabel)}
            {item.subject ? ` · ${item.subject}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-card-foreground">
            {item.body}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDateTimeInZone(item.at, timezone)}
            {/* The status is the honest part: "sent" is what the provider
                accepted, and a `failed` message must not look delivered on
                the record the operator trusts. D-014: the raw column value
                ("failed", "sent") is not a word a business owner reads at
                7 AM — labeled through MESSAGE_STATUS_LABEL (lib/labels.ts),
                the same map conversations.spec's own status chip uses,
                with the raw value as a fallback (matching the opportunity
                row below's own `STATUS_LABEL[...] ?? item.status`) so an
                unmapped future status still shows SOMETHING rather than
                going blank. */}
            {outbound ? ` · ${MESSAGE_STATUS_LABEL[item.status] ?? item.status}` : ""}
          </p>
          {/* D-017: same reason the thread shows (lib/email/failure-reason.ts)
              — the stored failure was never shown here either, on the one
              other screen that carries this message. */}
          {outbound && messageFailureReason(item) ? (
            <p className="mt-1 text-xs text-[var(--crit)]">{messageFailureReason(item)}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (item.kind === "submission") {
    return (
      <div className="flex gap-3 py-[7px]">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-card-foreground">
            {m["contact.formSubmission"]} · {item.formName}
          </p>
          <dl className="mt-1 space-y-0.5">
            {item.answers.map((answer) => (
              <div key={answer.key} className="flex gap-2 text-sm">
                <dt className="shrink-0 text-muted-foreground">{answer.label}:</dt>
                <dd className="min-w-0 break-words text-card-foreground">{answer.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTimeInZone(item.at, timezone)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-[7px]">
      <DollarSign className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-card-foreground">{item.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatCurrency(item.value)} · {STATUS_LABEL[item.status] ?? item.status} · {formatDateTimeInZone(item.at, timezone)}
        </p>
      </div>
    </div>
  );
}
