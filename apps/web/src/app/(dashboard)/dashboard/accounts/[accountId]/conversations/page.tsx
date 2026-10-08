import { MessagesSquare } from "lucide-react";
import { listConversations, getConversationSummary, listMessages } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { contactDisplayName } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { cn } from "@/lib/utils";
import { parseCursor, encodeCursor } from "@/lib/cursor";
import { m } from "@/lib/messages";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { EmailComposer } from "./email-composer";
import { MarkRead } from "./mark-read";
import { ConversationBack } from "./conversation-back";
import { sendEmailAction, markConversationReadAction } from "./actions";

export const dynamic = "force-dynamic";

/** One page of the inbox. A full page back is the only signal there may be
 *  more — `listConversations` returns rows, not a total — so it also
 *  decides whether the "Older" link renders (same idiom as calls/activity). */
const PAGE_SIZE = 50;

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ c?: string; before?: string }>;
}) {
  const { accountId } = await params;
  const { c, before } = await searchParams;
  const db = await dbForRequest();
  // Validated once: an unparseable `?before=` reads as "no cursor" (page
  // one) rather than throwing on a hand-editable URL — `parseCursor`'s own
  // contract (lib/cursor.ts).
  const cursor = parseCursor(before);
  const conversations = await listConversations(db, accountId, { limit: PAGE_SIZE, before: cursor });

  // The COLD-START reading of zero rows: no `?before=` cursor, so this is
  // page one and there is nothing behind it either — an account that has
  // genuinely never had a conversation. A cursored zero (below, inside the
  // normal render) means real history, just none older than the cursor.
  if (conversations.length === 0 && !cursor) {
    return (
      <>
        <PageHeader title={m["nav.conversations"]} />
        <div className="p-6">
          <EmptyState
            icon={MessagesSquare}
            title={m["conversations.empty.title"]}
            body={m["conversations.empty.body"]}
          />
        </div>
      </>
    );
  }

  const base = `/dashboard/accounts/${accountId}/conversations`;
  // The CURRENT page's cursor, re-usable on this render's own links (review
  // fix: DESIGN.md's "Selection survives a page change"). Not the raw
  // `before` unconditionally — an unparseable one already fell back to
  // page one above, and carrying the garbage forward into every row's own
  // link would propagate it rather than let it drop.
  const currentBefore = cursor ? before : undefined;
  const last = conversations[conversations.length - 1];
  const olderHref = conversations.length === PAGE_SIZE && last
    ? `${base}?${new URLSearchParams({ before: encodeCursor({ v: last.lastMessageAt, id: last.id }) })}`
    : undefined;
  const newerHref = cursor ? base : undefined;

  // No auto-selection. Falling back to conversations[0] meant that simply
  // landing on this screen opened the newest thread, which — now that opening a
  // thread clears its unread count — marked the newest inbound lead as read
  // before anyone had chosen to look at it. The badge is only worth anything if
  // it survives until a real open.
  //
  // `getConversationSummary` is the fallback, not the first read: a link
  // naming a conversation (an unread badge, a search hit) has no idea which
  // PAGE of this now-paged list it would fall on, and the common case — the
  // thread IS on the page already in hand — costs nothing extra by checking
  // there first.
  const active = c
    ? (conversations.find((conversation) => conversation.id === c)
      ?? (await getConversationSummary(db, accountId, c)) ?? undefined)
    : undefined;
  const messages = active ? await listMessages(db, accountId, active.id) : [];

  return (
    <>
      <PageHeader title={m["nav.conversations"]} />
      <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* D-021: below `lg` the two columns above stack into one scroll, so
            showing BOTH panes at once there meant a selected thread rendered
            below the whole list, with no way back to just the list. Below
            `lg`, show exactly one pane: the list when nothing is open, the
            thread (with its own Back link) once something is — `lg:block`
            brings the list back for the real two-column layout. */}
        <div className={cn(active ? "hidden lg:block" : "block")}>
          <ConversationList
            conversations={conversations}
            base={base}
            activeId={active?.id}
            olderHref={olderHref}
            newerHref={newerHref}
            before={currentBefore}
          />
        </div>
        {active ? (
          <div className="min-w-0 space-y-3">
            <ConversationBack base={base} before={currentBefore} />
            <MarkRead
              conversationId={active.id}
              unreadCount={active.unreadCount}
              action={markConversationReadAction.bind(null, accountId)}
            />
            <MessageThread
              messages={messages}
              contactName={contactDisplayName({
                first_name: active.contactFirstName,
                last_name: active.contactLastName,
              })}
              composer={
                <EmailComposer
                  contactId={active.contactId}
                  action={sendEmailAction.bind(null, accountId)}
                />
              }
            />
          </div>
        ) : (
          /* A bare dashed box was the one empty state on this route that did
             not carry the sanctioned treatment (the accent radial + icon).
             `EmptyState` is already imported for the no-conversations case
             eight lines up; this pane now reads as the same design.
             `hidden lg:flex`: below `lg` the list above is this screen's
             whole content — a second "pick a thread" pane under it would be
             the stacking D-021 exists to end, just for the empty case. */
          <EmptyState
            icon={MessagesSquare}
            title={m["conversations.pickThread"]}
            className="hidden lg:flex"
          />
        )}
      </div>
    </>
  );
}
