import { MessagesSquare } from "lucide-react";
import { serviceDb, listConversations, listMessages } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { EmailComposer } from "./email-composer";
import { sendEmailAction } from "./actions";

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
  const db = serviceDb();
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
  const activeId = c ?? conversations[0]!.id;
  const active = conversations.find((conversation) => conversation.id === activeId);
  const messages = active ? await listMessages(db, accountId, active.id) : [];

  return (
    <>
      <PageHeader title={m["nav.conversations"]} />
      <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ConversationList conversations={conversations} base={base} activeId={active?.id} />
        {active ? (
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
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            {m["conversations.pickThread"]}
          </div>
        )}
      </div>
    </>
  );
}
