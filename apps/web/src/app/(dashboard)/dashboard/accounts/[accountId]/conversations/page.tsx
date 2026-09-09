import { MessagesSquare } from "lucide-react";
import { listConversations, listMessages } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { contactDisplayName } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { EmailComposer } from "./email-composer";
import { MarkRead } from "./mark-read";
import { sendEmailAction, markConversationReadAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { accountId } = await params;
  const { c } = await searchParams;
  const db = await dbForRequest();
  const conversations = await listConversations(db, accountId);

  if (conversations.length === 0) {
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
  // No auto-selection. Falling back to conversations[0] meant that simply
  // landing on this screen opened the newest thread, which — now that opening a
  // thread clears its unread count — marked the newest inbound lead as read
  // before anyone had chosen to look at it. The badge is only worth anything if
  // it survives until a real open.
  const active = c ? conversations.find((conversation) => conversation.id === c) : undefined;
  const messages = active ? await listMessages(db, accountId, active.id) : [];

  return (
    <>
      <PageHeader title={m["nav.conversations"]} />
      <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ConversationList conversations={conversations} base={base} activeId={active?.id} />
        {active ? (
          <div className="min-w-0">
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
             eight lines up; this pane now reads as the same design. */
          <EmptyState icon={MessagesSquare} title={m["conversations.pickThread"]} />
        )}
      </div>
    </>
  );
}
