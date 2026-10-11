import { notFound } from "next/navigation";
import { getContact, listContactTags, listNotes, listContactTasks, holdOpenTaskIds,
         listCustomFields, listContactOpportunities, listContactSubmissions,
         listContactMessages } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { contactDisplayName, formatCurrency } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { requireAccountAccess } from "@/lib/auth";
import { loadAssignView, type AssignView } from "@/lib/assign/view";
import { m } from "@/lib/messages";
import { STATUS_LABEL } from "@/lib/labels";
import { ContactFieldsPanel } from "./contact-fields-panel";
import { RelationshipsCard } from "../relationships-card";
import { Card } from "@/components/ui/card";
import { ActivityTimeline } from "./activity-timeline";
import { sendEmailAction, sendSmsAction } from "../../conversations/actions";
import { resolveSmsSender } from "@/lib/sms/sender";
import { e164Of } from "@/lib/voice/phone-number";
import { smsRecipientState, emailRecipientState } from "@/lib/consent/recipient-state";
import { readTextsView } from "@/lib/consent/texts-view";
import type { TextsLoad } from "@/lib/consent/texts-row";
import { readEmailView } from "@/lib/consent/email-view";
import { ledgerDb } from "@/lib/consent/ledger-db";
import type { EmailLoad } from "@/lib/consent/email-row";
import { loggableError } from "@/lib/loggable-error";
import { composerStateLine, composerEmailNotice } from "@/lib/consent/composer-state";
import { renderZone } from "@/lib/zone";

export const dynamic = "force-dynamic";

/** "Assigned to" with nothing known: no picker, no team, no viewer (M4). */
const READ_ONLY_ASSIGN: AssignView = {
  who: "all", personId: null, assignee: undefined, canAssign: false, showMine: false, members: [],
};

export default async function ContactDetailPage({
  params,
}: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId } = await params;
  // F-085 part 1 (spec §9): the caller's role decides whether "Assigned to"
  // is a picker (Owner, Staff, the agency) or read-only (a Technician, M4).
  // The account layout already gated entry; this reads the role it discards.
  const access = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  // F-085 (spec §7.3): consent is keyed by ADDRESS and a STOP can arrive tied
  // to no contact, so under 0068 a Technician's own token sees only part of
  // the ledger — and would show "can text" for a number the send gate (which
  // reads through the service client) refuses. Every consent DISPLAY read
  // below therefore reads through this client, for every role. Built only
  // here, after getContact on the request client proved the contact is the
  // caller's to see: that read is the authorisation.
  const ledger = ledgerDb();
  const [tags, notes, tasks, fieldDefs, opps, submissions, messages, smsGate, account, smsRecipient, assign] = await Promise.all([
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
    // two facts the send gate checks, read for this proven contact's number
    // on the ledger client. Never throws; a failed read is "unknown", which
    // closes the form.
    smsRecipientState(ledger, accountId, contact),
    // The team the "Assigned to" pickers offer (none for a Technician), and
    // the viewer's own person for a read-only "You" (fix round 1, I1). A
    // failed read costs the field its picker, never the page (M4).
    loadAssignView(db, accountId, access, undefined, { members: true, viewer: true }).catch((e: unknown) => {
      console.error(`contact page: assignment read failed for account ${accountId}, Assigned to is read-only: ${loggableError(e)}`);
      return READ_ONLY_ASSIGN;
    }),
  ]);
  // The email composer's read (spec §6, choice 22): whether this contact's
  // email is stopped, and by whom. Never throws.
  const emailRecipient = await emailRecipientState(ledger, accountId, contact);
  // Not a throw, the checklist page's reasoning: one cosmetic date line must
  // not 500 the contact page. `undefined` makes `renderZone` fall back.
  if (account.error) {
    console.error(`contact page: account ${accountId} timezone read failed: ${account.error.message}`);
  }
  const zone = await renderZone((account.data as { timezone: string } | null)?.timezone);

  // The Texts row (consent chain PR-2, spec §6), read on the ledger client
  // for this proven contact's number. An unreadable ledger is the row's error state, never a thrown
  // page and never a guessed "Allowed".
  let texts: TextsLoad;
  try {
    texts = { status: "ready", view: await readTextsView(ledger, accountId, contact), zone: zone.zone, phone: contact.phone ?? null };
  } catch (e) {
    console.error(`contact page: Texts row unreadable for contact ${contactId}: ${loggableError(e)}`);
    texts = { status: "error" };
  }

  // The Email row (consent chain PR-3, spec §6), read on the ledger client
  // for this proven contact's address. An unreadable ledger is the row's error state, never a
  // thrown page.
  let email: EmailLoad;
  try {
    email = { status: "ready", view: await readEmailView(ledger, accountId, contact), zone: zone.zone };
  } catch (e) {
    console.error(`contact page: Email row unreadable for contact ${contactId}: ${loggableError(e)}`);
    email = { status: "error" };
  }

  // Review R3-N1 (G21): a To-do whose number is still on hold is closed by
  // deciding the hold, never by "Done", so the timeline shows a hint in its
  // place. A failed read fails CLOSED: every open linked To-do gets the hint
  // — a CANCEL To-do too (review M4), which is why the hint names the To do
  // page, where that To-do keeps its Done.
  let holdOpen: string[];
  try {
    // The tasks are the request client's; only the hold's ledger read moves.
    holdOpen = await holdOpenTaskIds(db, accountId, tasks, ledger);
  } catch (e) {
    console.error(`contact page: hold To-dos unreadable for contact ${contactId}: ${loggableError(e)}`);
    holdOpen = tasks.filter((t) => !t.completed_at && t.consent_event_id).map((t) => t.id);
  }

  return (
    <>
      <PageHeader title={contactDisplayName(contact)} />
      <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)_280px]">
        {/* One grid column: the fields panel's cards, then Related people under them (relationships
            spec §7). A bare sibling would take the grid's middle track from the timeline. */}
        <div className="min-w-0 space-y-4">
          <ContactFieldsPanel
            accountId={accountId}
            contactId={contactId}
            contact={contact}
            tags={tags}
            fieldDefs={fieldDefs}
            email={email}
            texts={texts}
            canAssign={assign.canAssign}
            members={assign.members}
            viewerId={assign.personId}
          />
          <Card className="gap-0 px-6 py-4">
            <RelationshipsCard accountId={accountId} contactId={contactId} />
          </Card>
        </div>
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
          emailNoticeLine={composerEmailNotice(emailRecipient, zone.zone)}
          notes={notes}
          tasks={tasks}
          holdOpenTaskIds={holdOpen}
          opportunities={opps}
          submissions={submissions}
          messages={messages}
          emailAction={sendEmailAction.bind(null, accountId)}
          smsAction={sendSmsAction.bind(null, accountId)}
          timezone={zone.zone}
          canAssign={assign.canAssign}
          members={assign.members}
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
