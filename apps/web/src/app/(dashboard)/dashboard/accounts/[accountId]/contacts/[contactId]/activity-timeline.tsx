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
import { formatCurrency, formatDate, formatDateUTC, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { STATUS_LABEL, messageChannelLabel } from "@/lib/labels";

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
  | { kind: "task"; id: string; at: string; title: string; dueAt: string | null; completedAt: string | null }
  | { kind: "opportunity"; id: string; at: string; name: string; value: number; status: string }
  | { kind: "submission"; id: string; at: string; formName: string;
      answers: { key: string; label: string; value: string }[] }
  | { kind: "message"; id: string; at: string; direction: string; subject: string | null;
      body: string; status: string; channel: string };

export function ActivityTimeline({
  accountId,
  contactId,
  contactHasEmail,
  contactHasPhone,
  smsGate,
  notes,
  tasks,
  opportunities,
  submissions,
  messages,
  emailAction,
  smsAction,
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
  notes: Note[];
  tasks: Task[];
  opportunities: Opportunity[];
  submissions: Submission[];
  /** Every message exchanged with this contact. Before these were passed, an
   *  email sent from THIS page appeared only in Conversations — the record it
   *  was sent from showed nothing. */
  messages: ContactMessage[];
  emailAction: (formData: FormData) => Promise<void>;
  smsAction: (formData: FormData) => Promise<void>;
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
              const day = formatDate(item.at);
              // Derive the separator from the previous item rather than a
              // carried variable — mutating during render is not safe.
              const showSeparator = i === 0 || day !== formatDate(items[i - 1]!.at);
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
                  <TimelineRow item={item} hidden={hidden} completeAction={boundCompleteTask} />
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
          noteAction={boundAddNote}
          emailAction={emailAction}
          smsAction={smsAction}
        />
      </CardFooter>
    </Card>
  );
}

function TimelineRow({
  item,
  hidden,
  completeAction,
}: {
  item: TimelineItem;
  hidden: React.ReactNode;
  completeAction: (formData: FormData) => Promise<void>;
}) {
  if (item.kind === "note") {
    return (
      <div className="flex gap-3 py-[7px]">
        <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-card-foreground">{item.body}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.at)}</p>
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
            <span>{formatDateTime(item.at)}</span>
            {item.dueAt ? (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3" aria-hidden />
                {formatDateUTC(item.dueAt)}
              </span>
            ) : null}
          </div>
        </div>
        {!done ? (
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
            {formatDateTime(item.at)}
            {/* The status is the honest part: "sent" is what the provider
                accepted, and a `failed` message must not look delivered on
                the record the operator trusts. */}
            {outbound ? ` · ${item.status}` : ""}
          </p>
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
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.at)}</p>
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
          {formatCurrency(item.value)} · {STATUS_LABEL[item.status] ?? item.status} · {formatDateTime(item.at)}
        </p>
      </div>
    </div>
  );
}
