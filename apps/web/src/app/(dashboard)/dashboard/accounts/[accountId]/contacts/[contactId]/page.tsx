import { notFound } from "next/navigation";
import { getContact, listContactTags, listNotes, listContactTasks,
         listCustomFields, listContactOpportunities, listContactSubmissions,
         listContactMessages } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { contactDisplayName, formatCurrency } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { STATUS_LABEL } from "@/lib/labels";
import { ContactFieldsPanel } from "./contact-fields-panel";
import { ActivityTimeline } from "./activity-timeline";
import { sendEmailAction, sendSmsAction } from "../../conversations/actions";
import { resolveSmsSender } from "@/lib/sms/sender";
import { e164Of } from "@/lib/voice/phone-number";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { composerStateLine } from "@/lib/consent/composer-state";
import { renderZone } from "@/lib/zone";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId } = await params;
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  const [tags, notes, tasks, fieldDefs, opps, submissions, messages, smsGate, account, smsRecipient] = await Promise.all([
    listContactTags(db, accountId, contactId),
    listNotes(db, accountId, contactId),
    listContactTasks(db, accountId, contactId),
    listCustomFields(db, accountId, "contact"),
    listContactOpportunities(db, accountId, contactId),
    listContactSubmissions(db, accountId, contactId),
    listContactMessages(db, accountId, contactId),
    // Resolved here (server component) and passed down as a prop — the
    // composer is a client component and must not query the database.
    resolveSmsSender(db, accountId),
    // Only for the opt-out's "Off since" date, printed in the ACCOUNT's zone.
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
    // The ledger state and F-009's flag for the text composer (spec §6): the
    // two facts the send gate checks, read under this request's RLS client.
    // Never throws; a failed read is "unknown", which closes the form.
    smsRecipientState(db, accountId, contact),
  ]);
  // Not a throw, the checklist page's reasoning: one cosmetic date line must
  // not 500 the contact page. `undefined` makes `renderZone` fall back.
  if (account.error) {
    console.error(`contact page: account ${accountId} timezone read failed: ${account.error.message}`);
  }
  const zone = await renderZone((account.data as { timezone: string } | null)?.timezone);

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
          zone={{ zone: zone.zone, guessed: zone.guessed, label: zone.label }}
        />
        <ActivityTimeline
          accountId={accountId}
          contactId={contactId}
          contactHasEmail={Boolean(contact.email)}
          // Same e164Of-based notion of "usable" sendSmsAction itself gates
          // on (actions.ts) — mirrors contactHasEmail above so SMS fails up
          // front, in place of the form, instead of only on submit.
          contactHasPhone={Boolean(e164Of(contact.phone))}
          smsGate={smsGate}
          smsBlockedLine={composerStateLine(smsRecipient, zone.zone)}
          notes={notes}
          tasks={tasks}
          opportunities={opps}
          submissions={submissions}
          messages={messages}
          emailAction={sendEmailAction.bind(null, accountId)}
          smsAction={sendSmsAction.bind(null, accountId)}
        />
        <aside className="rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3">
          <p className="mb-2 text-[13.5px] font-semibold text-card-foreground">
            {m["contact.opportunities"]}
          </p>
          {opps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m["contact.noOpportunities"]}</p>
          ) : (
            /* The mockup's list idiom is a RULE, never a box per row
               (`.row`, northern-lights.html:122) — and a bordered box inside
               a glass card is the nested-card shape the ladder forbids. */
            <ul className="flex flex-col text-sm">
              {opps.map((o) => (
                <li key={o.id} className="border-t border-[var(--row-line)] py-[7px] first:border-t-0">
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
