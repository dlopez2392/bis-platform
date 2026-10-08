import Link from "next/link";
import type { ConversationSummary } from "@bis/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { contactDisplayName, formatDateTime } from "@/lib/format";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";

export function ConversationList({
  conversations,
  base,
  activeId,
  olderHref,
  newerHref,
  before,
}: {
  conversations: ConversationSummary[];
  base: string;
  activeId: string | undefined;
  /** D-019: DESIGN.md "Paged lists" — cursor paging, `?before=`, exactly
   *  ONE pager, which lives here, below the panel, same placement as
   *  ActivityTable/CallsTable's own. Undefined on the page `page.tsx`
   *  already knows has no more/no fewer rows behind it. */
  olderHref?: string;
  newerHref?: string;
  /** The page currently in view (review fix: DESIGN.md's "Selection
   *  survives a page change"). A row's link carried only `?c=<id>` — opening
   *  a thread from page 2 of the inbox landed, on Back, at page one, because
   *  nothing on the row's own href said which page it came from. Carried on
   *  EVERY row, not only the active one: any row on this page could be
   *  opened next. */
  before?: string;
}) {
  return (
    <div className="space-y-3">
      <ListPanel as="nav" className="flex flex-col">
        {conversations.map((conversation) => {
          const name = contactDisplayName({
            first_name: conversation.contactFirstName,
            last_name: conversation.contactLastName,
          });
          const rowParams = new URLSearchParams();
          if (before) rowParams.set("before", before);
          rowParams.set("c", conversation.id);
          return (
            <Link
              key={conversation.id}
              href={`${base}?${rowParams}`}
              className={cn(
                "flex flex-col gap-0.5 px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-3)]",
                LIST_ROW,
                // Selection is --accent-dim everywhere else in the app
                // (ui/table.tsx's `data-[state=selected]`); `bg-secondary` was
                // the raised hover step doing double duty as the active state.
                conversation.id === activeId && "bg-[var(--accent-dim)]",
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
      </ListPanel>
      {olderHref || newerHref ? (
        <nav className="flex justify-end gap-2" aria-label={m["conversations.pagesLabel"]}>
          {newerHref ? (
            <Link href={newerHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {m["conversations.newer"]}
            </Link>
          ) : null}
          {olderHref ? (
            <Link href={olderHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {m["conversations.older"]}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
