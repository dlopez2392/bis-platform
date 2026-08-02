import { notFound } from "next/navigation";
import { getContact, listContactTags, listNotes, listContactTasks,
         listCustomFields, listContactOpportunities, listContactSubmissions } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { contactDisplayName, formatCurrency } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { STATUS_LABEL } from "@/lib/labels";
import { ContactFieldsPanel } from "./contact-fields-panel";
import { ActivityTimeline } from "./activity-timeline";
import { sendEmailAction } from "../../conversations/actions";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId } = await params;
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  const [tags, notes, tasks, fieldDefs, opps, submissions] = await Promise.all([
    listContactTags(db, accountId, contactId),
    listNotes(db, accountId, contactId),
    listContactTasks(db, accountId, contactId),
    listCustomFields(db, accountId, "contact"),
    listContactOpportunities(db, accountId, contactId),
    listContactSubmissions(db, accountId, contactId),
  ]);

  return (
    <>
      <PageHeader title={contactDisplayName(contact)} />
      <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)_280px]">
        <ContactFieldsPanel
          accountId={accountId}
          contactId={contactId}
          contact={contact}
          tags={tags}
          fieldDefs={fieldDefs}
        />
        <ActivityTimeline
          accountId={accountId}
          contactId={contactId}
          contactHasEmail={Boolean(contact.email)}
          notes={notes}
          tasks={tasks}
          opportunities={opps}
          submissions={submissions}
          emailAction={sendEmailAction.bind(null, accountId)}
        />
        <aside className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-sm font-medium text-card-foreground">
            {m["contact.opportunities"]}
          </p>
          {opps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m["contact.noOpportunities"]}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {opps.map((o) => (
                <li key={o.id} className="rounded-md border border-border p-2">
                  <p className="truncate font-medium">{o.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(Number(o.monetary_value))} · {STATUS_LABEL[o.status] ?? o.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
