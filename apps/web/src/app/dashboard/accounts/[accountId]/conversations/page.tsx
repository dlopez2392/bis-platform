import { MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { m } from "@/lib/messages";

export default function ConversationsPage() {
  return (
    <>
      <PageHeader title={m["nav.conversations"]} />
      <div className="p-6">
        <EmptyState
          icon={MessagesSquare}
          title={m["empty.conversations.title"]}
          body={m["empty.conversations.body"]}
        />
      </div>
    </>
  );
}
