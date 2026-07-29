import type { listMessages } from "@bis/db";
import { formatDateTime } from "@/lib/format";
import { MESSAGE_STATUS_LABEL } from "@/lib/labels";
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
    <div className="flex flex-col rounded-lg border border-border bg-card">
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
              {formatDateTime(message.created_at)} ·{" "}
              {MESSAGE_STATUS_LABEL[message.status] ?? message.status}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4">{composer}</div>
    </div>
  );
}
