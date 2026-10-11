import { MessagesSquare } from "lucide-react";
import { listConversations, getConversationSummary, listMessages } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { WhoFilter } from "@/components/assign/who-filter";
import { contactDisplayName } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { cn } from "@/lib/utils";
import { parseCursor, encodeCursor } from "@/lib/cursor";
import { requireAccountAccess } from "@/lib/auth";
import { withWho } from "@/lib/assign/who";
import { loadAssignView } from "@/lib/assign/view";
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
  searchParams: Promise<{ c?: string; before?: string; who?: string }>;
}) {
  const { accountId } = await params;
  const { c, before, who: rawWho } = await searchParams;
  const access = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  // F-085 part 1 (spec §8-§9): Mine / Unassigned, by the CUSTOMER's holder,
  // applied by listConversations on the server. Never for a Technician
  // (their inbox is already theirs). No team read: nothing here assigns.
  const assign = await loadAssignView(db, accountId, access, rawWho, { members: false });
  // Validated once: an unparseable `?before=` reads as "no cursor" (page
  // one) rather than throwing on a hand-editable URL — `parseCursor`'s own
  // contract (lib/cursor.ts).
  const cursor = parseCursor(before);
  const [conversations, account] = await Promise.all([
    listConversations(db, accountId, { limit: PAGE_SIZE, before: cursor, assignee: assign.assignee }),
    // The zone every row's own timestamp renders in below — not a throw: one
    // cosmetic date column must not take the whole inbox down, same reasoning
    // as the contacts list's own read (D-010).
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
  ]);
  if (account.error) {
    console.error(`conversations: account ${accountId} timezone read failed: ${account.error.message}`);
  }
  const zone = await renderZone((account.data as { timezone: string } | null)?.timezone);
  const base = `/dashboard/accounts/${accountId}/conversations`;

  // F-085 part 1 (spec §9): All · Mine · Unassigned, for those who see the
  // whole account, on BOTH renders below: an emptied filter must still offer
  // the way back to All. Carries nothing else: a filter change returns to
  // page one, and the open thread (`c`) belonged to the old list.
  const header = (
    <PageHeader
      title={m["nav.conversations"]}
      filters={assign.canAssign ? (
        <WhoFilter base={base} current={assign.who} showMine={assign.showMine} params={{}} />
      ) : undefined}
    />
  );

  // The COLD-START reading of zero rows: no `?before=` cursor, so this is
  // page one and there is nothing behind it either — an account that has
  // genuinely never had a conversation. A cursored zero (below, inside the
  // normal render) means real history, just none older than the cursor.
  if (conversations.length === 0 && !cursor) {
    // An emptied filter is not an empty inbox (F-085), so it says which.
    const empty = assign.who === "mine"
      ? { title: m["assign.empty.mine"] }
      : assign.who === "unassigned"
        ? { title: m["assign.empty.unassigned"] }
        : { title: m["conversations.empty.title"], body: m["conversations.empty.body"] };
    return (
      <>
        {header}
        <div className="p-6">
          <EmptyState icon={MessagesSquare} title={empty.title} body={empty.body} />
        </div>
      </>
    );
  }

  // The CURRENT page's cursor, re-usable on this render's own links (review
  // fix: DESIGN.md's "Selection survives a page change"). Not the raw
  // `before` unconditionally — an unparseable one already fell back to
  // page one above, and carrying the garbage forward into every row's own
  // link would propagate it rather than let it drop.
  const currentBefore = cursor ? before : undefined;
  const last = conversations[conversations.length - 1];
  const olderHref = conversations.length === PAGE_SIZE && last
    ? `${base}?${new URLSearchParams(withWho({ before: encodeCursor({ v: last.lastMessageAt, id: last.id }) }, assign.who))}`
    : undefined;
  // Back to page one of the SAME filter (F-085): Mine's head, not the whole inbox's.
  const headQs = new URLSearchParams(withWho({}, assign.who)).toString();
  const newerHref = cursor ? (headQs ? `${base}?${headQs}` : base) : undefined;

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
      {header}
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
            timezone={zone.zone}
            who={assign.who}
          />
        </div>
        {active ? (
          <div className="min-w-0 space-y-3">
            <ConversationBack base={base} before={currentBefore} who={assign.who} />
            <MarkRead
              conversationId={active.id}
              unreadCount={active.unreadCount}
              action={markConversationReadAction.bind(null, accountId)}
            />
            <MessageThread
              messages={messages}
              timezone={zone.zone}
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
