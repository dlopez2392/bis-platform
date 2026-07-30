import Link from "next/link";
import type { ConversationSummary } from "@bis/db";
import { Badge } from "@/components/ui/badge";
import { contactDisplayName, formatDateTime } from "@/lib/format";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";

export function ConversationList({
  conversations,
  base,
  activeId,
}: {
  conversations: ConversationSummary[];
  base: string;
  activeId: string | undefined;
}) {
  return (
    <nav className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {conversations.map((conversation) => {
        const name = contactDisplayName({
          first_name: conversation.contactFirstName,
          last_name: conversation.contactLastName,
        });
        return (
          <Link
            key={conversation.id}
            href={`${base}?c=${conversation.id}`}
            className={cn(
              "flex flex-col gap-0.5 px-3 py-2.5 text-sm transition-colors hover:bg-secondary/60",
              conversation.id === activeId && "bg-secondary",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={cn(
                "truncate text-card-foreground",
                conversation.unreadCount > 0 ? "font-semibold" : "font-medium",
              )}>
                {name}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {conversation.unreadCount > 0 ? (
                  <Badge aria-label={`${conversation.unreadCount} ${m["conversations.unread"]}`}>
                    {conversation.unreadCount}
                  </Badge>
                ) : null}
                {conversation.lastMessageAt ? (
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(conversation.lastMessageAt)}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {conversation.lastMessagePreview}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
