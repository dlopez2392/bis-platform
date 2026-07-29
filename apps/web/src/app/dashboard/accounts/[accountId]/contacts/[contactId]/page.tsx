import { notFound } from "next/navigation";
import { serviceDb, getContact, listContactTags, listNotes, listContactTasks,
         listCustomFields, listContactOpportunities } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { contactDisplayName, formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";
import { STATUS_LABEL } from "@/lib/labels";
import { ContactFieldsPanel } from "./contact-fields-panel";
import { ActivityTimeline } from "./activity-timeline";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId } = await params;
  const db = serviceDb();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  const [tags, notes, tasks, fieldDefs, opps] = await Promise.all([
    listContactTags(db, accountId, contactId),
    listNotes(db, accountId, contactId),
    listContactTasks(db, accountId, contactId),
    listCustomFields(db, accountId, "contact"),
    listContactOpportunities(db, accountId, contactId),
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
          notes={notes}
          tasks={tasks}
          opportunities={opps}
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
