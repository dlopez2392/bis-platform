import type { listMessages } from "@bis/db";
import { formatDateTime } from "@/lib/format";
import { MESSAGE_STATUS_LABEL, MESSAGE_CHANNEL_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Message = Awaited<ReturnType<typeof listMessages>>[number];

export function MessageThread({
  messages,
  contactName,
  composer,
}: {
  messages: Message[];
  contactName: string;
  composer: React.ReactNode;
}) {
  return (
    // The thread pane is bounded to the viewport (topbar h-14 = 56px + the
    // title-only PageHeader here = 69px + the conversations grid's p-6 top/
    // bottom padding = 48px) only from `lg` up, where the two-column layout
    // applies — that's what lets the inner overflow-y-auto region actually
    // engage instead of growing the whole page. Below `lg` the panes stack,
    // where a fixed cap would look wrong, so it's left unbounded there.
    <div className="flex flex-col rounded-lg border border-border bg-card lg:max-h-[calc(100vh-173px)]">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium text-card-foreground">{contactName}</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[75%] rounded-lg px-3 py-2",
              message.direction === "outbound" ? "ml-auto bg-primary/10" : "bg-secondary",
            )}
          >
            {message.subject ? (
              <p className="text-sm font-medium text-card-foreground">{message.subject}</p>
            ) : null}
            <p className="whitespace-pre-wrap text-sm text-card-foreground">{message.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(message.created_at)}
              {message.channel !== "email" ? (
                <> · {MESSAGE_CHANNEL_LABEL[message.channel] ?? message.channel}</>
              ) : null}
              {message.direction === "outbound" ? (
                <> · {MESSAGE_STATUS_LABEL[message.status] ?? message.status}</>
              ) : null}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4">{composer}</div>
    </div>
  );
}
