import type { listMessages } from "@bis/db";
import { formatDateTime } from "@/lib/format";
import { MESSAGE_STATUS_LABEL, messageChannelLabel } from "@/lib/labels";
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
    // The blur is on the CARD, not on the rows — this pane scrolls internally
    // (the region below) and the mockup's own note only warns off blurring the
    // long list itself, which is why the bubbles stay flat.
    <div className="flex flex-col rounded-xl border border-border bg-card glass lg:max-h-[calc(100vh-173px)]">
      <div className="border-b border-[var(--row-line)] px-4 py-3">
        <p className="text-[13.5px] font-semibold text-card-foreground">{contactName}</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <div
            key={message.id}
            // Ladder step 2 inbound, `--accent-dim` outbound — the selection
            // colour the rest of the app uses. NEVER glass: there can be
            // hundreds of these in one thread. Outbound used to carry a raw
            // 10% alpha of the brand colour, which no token names.
            className={cn(
              "max-w-[75%] rounded-[var(--radius-ctl)] px-3 py-2",
              message.direction === "outbound"
                ? "ml-auto bg-[var(--accent-dim)]"
                : "bg-[var(--surface-2)]",
            )}
          >
            {message.subject ? (
              <p className="text-sm font-medium text-card-foreground">{message.subject}</p>
            ) : null}
            <p className="whitespace-pre-wrap text-sm text-card-foreground">{message.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(message.created_at)}
              {message.channel !== "email" ? (
                // `message.channel` is a raw DB string (untyped Supabase
                // client, no generated schema types) — messageChannelLabel
                // (lib/labels.ts) is the one place that widens it against the
                // exhaustive channel map, with a fallback for anything
                // outside it (e.g. "note", never actually written to this
                // table; see messaging.ts).
                <> · {messageChannelLabel(message.channel)}</>
              ) : null}
              {message.direction === "outbound" ? (
                <> · {MESSAGE_STATUS_LABEL[message.status] ?? message.status}</>
              ) : null}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--row-line)] p-4">{composer}</div>
    </div>
  );
}
