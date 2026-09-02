import { Users } from "lucide-react";
import { listContacts, listTags } from "@bis/db";
import { createContactAction } from "./actions";
import { ContactsTable } from "./contacts-table";
import { AddContactDialog } from "./add-contact-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { accountId } = await params;
  const { q } = await searchParams;
  const db = await dbForRequest();
  const [contacts, tags] = await Promise.all([
    listContacts(db, accountId, { search: q }),
    listTags(db, accountId),
  ]);
  const base = `/dashboard/accounts/${accountId}/contacts`;
  const boundCreateContact = createContactAction.bind(null, accountId);

  return (
    <>
      <PageHeader
        title={m["contacts.title"]}
        count={`${contacts.length}`}
        actions={<AddContactDialog action={boundCreateContact} />}
        search={
          <form action={base}>
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder={m["contacts.search"]}
              className="w-72"
            />
          </form>
        }
      />
      <div className="p-6">
        {contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? m["contacts.noMatches.title"] : m["contacts.empty.title"]}
            body={q ? m["contacts.noMatches.body"] : m["contacts.empty.body"]}
          />
        ) : (
          <ContactsTable rows={contacts} accountId={accountId} existingTags={tags} />
        )}
      </div>
    </>
  );
}
