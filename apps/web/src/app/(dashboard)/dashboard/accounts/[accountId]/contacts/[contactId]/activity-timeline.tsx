import { CalendarClock, CheckSquare, DollarSign, History, Square, StickyNote } from "lucide-react";
import type { listNotes, listContactTasks, listContactOpportunities } from "@bis/db";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatDate, formatDateUTC, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { STATUS_LABEL } from "@/lib/labels";
import { addNoteAction, addTaskAction, completeTaskAction } from "./actions";
import { MessageComposer } from "./message-composer";

type Note = Awaited<ReturnType<typeof listNotes>>[number];
type Task = Awaited<ReturnType<typeof listContactTasks>>[number];
type Opportunity = Awaited<ReturnType<typeof listContactOpportunities>>[number];

type TimelineItem =
  | { kind: "note"; id: string; at: string; body: string }
  | { kind: "task"; id: string; at: string; title: string; dueAt: string | null; completedAt: string | null }
  | { kind: "opportunity"; id: string; at: string; name: string; value: number; status: string };

export function ActivityTimeline({
  accountId,
  contactId,
  contactHasEmail,
  notes,
  tasks,
  opportunities,
  emailAction,
}: {
  accountId: string;
  contactId: string;
  contactHasEmail: boolean;
  notes: Note[];
  tasks: Task[];
  opportunities: Opportunity[];
  emailAction: (formData: FormData) => Promise<void>;
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
          className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2"
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
          <ol className="space-y-3">
            {items.map((item, i) => {
              const day = formatDate(item.at);
              // Derive the separator from the previous item rather than a
              // carried variable — mutating during render is not safe.
              const showSeparator = i === 0 || day !== formatDate(items[i - 1]!.at);
              return (
                <li key={`${item.kind}-${item.id}`}>
                  {showSeparator ? (
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
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
          noteAction={boundAddNote}
          emailAction={emailAction}
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
      <div className="flex gap-3 rounded-lg border border-border bg-card p-3">
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
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
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

  return (
    <div className="flex gap-3 rounded-lg border border-border bg-card p-3">
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
