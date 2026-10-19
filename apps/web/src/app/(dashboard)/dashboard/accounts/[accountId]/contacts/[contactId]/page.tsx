import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getContact, getInboundSettings, readReplyToken, serviceDb } from "@bis/db";
import { contactDisplayName } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { loadAssignView, type AssignView } from "@/lib/assign/view";
import type { MessageKey } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordHeader, type RecordHeaderAction } from "@/components/record/record-header";
import { RecordCard, type RecordCardState } from "@/components/record/record-card";
import { RECORD_CARDS, columnRuns, type RecordCardId } from "@/lib/record/record-cards";
import { makeTr } from "@/lib/record/copy";
import { factsView } from "@/lib/record/record-facts";
import { nextUpView } from "@/lib/record/next-up";
import { headerActions, headerActionLabels, canTextFrom, firstMapUrl } from "@/lib/record/header-actions";
import {
  loadSummary, loadNextUp, loadTimeline, loadDeals, loadTags, loadFieldDefs, loadHeaderPlaces, softSmsGate,
  loadWaitingSuggestions,
} from "@/lib/record/loaders";
import { buildSuggestionView } from "@/lib/proposals/view";
import { WaitingSuggestions, type WaitingData } from "@/components/proposals/suggestion-row";
import {
  acceptSuggestionAction, editAcceptSuggestionAction, discardSuggestionAction, undoSuggestionAction,
} from "@/lib/proposals/actions";
import { timelineRows, timelineFailedText } from "@/lib/record/timeline-rows";
import { timelinePagerHrefs } from "@/lib/record/timeline-pager";
import { parseTimelineCursor } from "@/lib/cursor";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import type { Locale } from "@/lib/i18n/locale";
import { ContactDetailsBody, ContactTagsBody } from "./contact-fields-panel";
import { RelationshipsCard } from "../relationships-card";
import { ActivityTimeline } from "./activity-timeline";
import { GroupsCard } from "../groups-card";
import { PlacesCard } from "../places-card";
import { DocumentsCard } from "../documents-card";
import { cardFocusFrom } from "@/lib/documents/card-focus";
import { SummaryBody } from "./summary-card";
import { AiSummary } from "./ai-summary";
import { NextUpBody } from "./next-up-card";
import { DealsBody } from "./deals-card";
import { sendEmailAction, sendSmsAction } from "../../conversations/actions";
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
import { languageView, type ContactLanguageFacts } from "@/lib/contacts/language";
import { loadForwardingView } from "@/lib/email/inbound/forwarding-view";

export const dynamic = "force-dynamic";

/** "Assigned to" with nothing known: no picker, no team, no viewer (M4). */
const READ_ONLY_ASSIGN: AssignView = {
  who: "all", personId: null, assignee: undefined, canAssign: false, showMine: false, members: [],
};

/** `defaultOpen`: S-07 3a (review I2), a phone disclosure that starts open. */
type Slot = { node: ReactNode; state?: RecordCardState; errorText?: string; defaultOpen?: boolean };

/**
 * The contact record page (S-03 part 1; spec §§8–9). Three columns on a desk (who they are |
 * what is happening | what they have); one column on a phone in the order a person acts in. Every
 * card has its own loader (never throws) and its own boundary, so one card's fault never blanks the
 * page. 1b: the timeline is one server page across seven sources, every row marked with who made it.
 */
export default async function ContactDetailPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string; contactId: string }>;
  // Optional, as dashboard/page.tsx's: the QA locale override (`?locale=es|pseudo`, BIS_I18N_QA only),
  // and the timeline's cursor (1b).
  searchParams?: Promise<{ locale?: string; before?: string; document?: string; ask?: string }>;
}) {
  const { accountId, contactId } = await params;
  const { locale: localeParam, before: beforeParam, document: documentParam, ask: askParam } = (await searchParams) ?? {};
  // S-07 3a (plan deviations 5, 6): a To-do's link names a file to focus and a category to pre-tick in Ask the customer.
  const focus = cardFocusFrom({ document: documentParam, ask: askParam });
  // 1b (spec §11): parsed before any read; a ?before= that does not parse is a cold start, never an
  // error and never seven failed sources.
  const before = parseTimelineCursor(beforeParam);
  // F-085 part 1 (spec §9): the caller's role decides whether "Assigned to" is a picker (Owner,
  // Staff, the agency) or read-only (a Technician, M4).
  const access = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  // F-085 (spec §7.3): consent is keyed by ADDRESS and a STOP can arrive tied to no contact, so a
  // Technician's own token sees only part of the ledger. Every consent DISPLAY read (and the hold
  // check's ledger read) goes through this client, built only here, after getContact on the request
  // client proved the contact is the caller's to see: that read is the authorisation.
  const ledger = ledgerDb();
  const now = new Date();
  const [prefs, tags, fieldDefs, smsGate, account, smsRecipient, assign, summary, nextUp, timeline, deals, places, forwarding, waiting] = await Promise.all([
    getPersonPrefs(),
    loadTags(db, accountId, contactId),
    loadFieldDefs(db, accountId),
    // Resolved here (server component) and passed down; the composer must not query the database.
    softSmsGate(db, accountId),
    // The account's zone (dates) and language (a client's default locale), one row.
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    // The two facts the send gate checks, on the ledger client. Never throws; "unknown" closes the form.
    smsRecipientState(ledger, accountId, contact),
    // A failed team read costs "Assigned to" its picker, never the page (M4).
    loadAssignView(db, accountId, access, undefined, { members: true, viewer: true }).catch((e: unknown) => {
      console.error(`contact page: assignment read failed for account ${accountId}, Assigned to is read-only: ${loggableError(e)}`);
      return READ_ONLY_ASSIGN;
    }),
    loadSummary(db, accountId, contactId),
    loadNextUp(db, accountId, contactId, now),
    loadTimeline(db, ledger, accountId, contactId, before),
    loadDeals(db, accountId, contactId),
    loadHeaderPlaces(db, accountId, contactId),
    // S-06 part 2 (spec §1, plan G15 as amended 2026-10-17): the Forwarding address. getContact above, on
    // the request client, proved this customer is the viewer's; only then is the token READ, on the
    // service client. A page view never makes one: "Get forwarding address" does (forwarding-actions.ts).
    loadForwardingView({
      settings: () => getInboundSettings(serviceDb(), accountId),
      token: () => readReplyToken(serviceDb(), accountId, contactId),
      log: (line) => console.error(`contact page: account ${accountId} ${line}`),
    }, { isAgency: access.isAgency }),
    // Item 8b-2 (spec 5.3): What's next's "Waiting for you", this customer's pending suggestions on the
    // request client (RLS decides). Never throws: a failure is the section's own error line.
    loadWaitingSuggestions(db, accountId, contactId, now),
  ]);
  // The email composer's read (consent spec §6, choice 22). Never throws.
  const emailRecipient = await emailRecipientState(ledger, accountId, contact);
  // Not a throw: one cosmetic date line must not 500 the page. `undefined` makes `renderZone` fall back.
  if (account.error) {
    console.error(`contact page: account ${accountId} timezone and language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  // Every date below is drawn in THIS zone, never `accounts.timezone` raw: an invalid stored zone
  // would throw in two of the formatters and silently drop the third (review ruling).
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  // The Texts and Email rows (consent PR-2/PR-3), on the ledger client. An unreadable ledger is the
  // row's error state, never a thrown page and never a guessed "Allowed".
  let texts: TextsLoad;
  try {
    texts = { status: "ready", view: await readTextsView(ledger, accountId, contact), zone: zone.zone, phone: contact.phone ?? null };
  } catch (e) {
    console.error(`contact page: Texts row unreadable for contact ${contactId}: ${loggableError(e)}`);
    texts = { status: "error" };
  }
  let email: EmailLoad;
  try {
    email = { status: "ready", view: await readEmailView(ledger, accountId, contact), zone: zone.zone };
  } catch (e) {
    console.error(`contact page: Email row unreadable for contact ${contactId}: ${loggableError(e)}`);
    email = { status: "error" };
  }

  /**
   * A view model is built HERE, in the page body, outside every card's boundary, so a throw while
   * building one (a malformed instant from a read) would reject the whole page. Each is built in its
   * own try instead: a failure costs only its own card (C5), logged by card and account (spec §11).
   */
  const viewOf = <T,>(card: string, build: () => T): T | null => {
    try {
      return build();
    } catch (e) {
      console.error(`record page: ${card} view failed for account ${accountId}: ${loggableError(e)}`);
      return null;
    }
  };

  // 1b: the composer's consent line in the page's language (Task 3's locale parameter).
  const smsBlockedLine = composerStateLine(smsRecipient, zone.zone, locale);
  const name = contactDisplayName(contact);
  // Task 8 fix round: the Documents card's "Ask the customer" dialog wants the RAW joined name, not
  // contactDisplayName's "(no name)" placeholder — a non-empty placeholder would stop requestTitle's
  // own fallback ("Ask the customer") from ever firing for a nameless contact.
  const rawName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  const mainGroup = places?.groups.find((g) => g.isPrimary) ?? places?.groups[0] ?? null;
  const subtitle = mainGroup
    ? tr.text(mainGroup.kind === "household" ? "record.group.household" : "record.group.business", { group: mainGroup.name })
    : null;
  // 1b: the rows are built here, in their own guard (C5), so a malformed row costs the timeline card.
  const timelineView = timeline.status === "ready"
    ? viewOf("timeline", () => timelineRows(timeline.page.items, {
      zone: zone.zone, tr,
      author: { viewerId: access.userId, names: timeline.names, personaName: timeline.personaName, tr },
    }))
    : null;
  // Text and Email link to the composer inside the timeline card; when that card failed there is no
  // composer behind them, so they hide (D3: an action with nothing behind it is hidden). Call stays.
  const composerShown = timelineView !== null;
  const actions: RecordHeaderAction[] = headerActionLabels(headerActions({
    phone: contact.phone ?? null,
    email: composerShown ? contact.email ?? null : null,
    canText: composerShown && canTextFrom({ phone: contact.phone ?? null, smsGate, smsBlockedLine }),
    directionsUrl: places ? firstMapUrl(places.places, contactId, places.groups) : null,
  }), tr, name);

  const facts = summary.status === "ready"
    ? viewOf("summary", () => factsView({ createdAt: contact.created_at, facts: summary.facts }, { zone: zone.zone, now, tr }))
    : null;
  const upNext = nextUp.status === "ready" ? viewOf("next up", () => nextUpView(nextUp.data, { zone: zone.zone, now, tr })) : null;
  // "Waiting for you" (item 8b-2, spec 5.3): built in its own guard, so a row that cannot be shown is the
  // section's error line, never What's next's card. The persona is the timeline's one read (spec 5.3);
  // the rows are this customer's own, so their source label names no caller.
  const waitingData: WaitingData = (waiting.status === "ready"
    ? viewOf("waiting suggestions", () => ({
      ok: true as const,
      views: waiting.rows.map((row) => buildSuggestionView(row, {
        tr, zone: zone.zone, now, ...waiting.stages, callerName: null, callStartedAt: null,
        personaName: (timeline.status === "ready" ? timeline.personaName : null) ?? "Sofía",
        names: {}, viewerId: access.userId,
      })),
    }))
    : null) ?? { ok: false };
  // review M1/M-2: a bad stored date (etc.) costs this one line, never the whole page, and the line
  // is LEFT OUT (no prop, no row) rather than a "Not set." that would be false for a set contact.
  const language = viewOf("language", () => languageView(contact as unknown as ContactLanguageFacts, {
    zone: zone.zone, tr, accountLanguage: accountRow ? (accountRow.language ?? null) : undefined,
  })) ?? undefined;
  // Item 8a-2 (spec 4.1): the AI part's own route; the QA locale override travels with it (as the drawer's does).
  const aiSummaryUrl = `/api/accounts/${accountId}/contacts/${contactId}/ai-summary${localeParam ? `?locale=${encodeURIComponent(localeParam)}` : ""}`;

  const failed = (errorText: string): Slot => ({ node: null, state: "error", errorText });
  const cardFailed = (titleKey: MessageKey) => failed(tr.text("record.card.failed", { title: tr.text(titleKey) }));
  const slots = {
    summary: facts
      ? {
        node: (
          <div className="space-y-3">
            <SummaryBody view={facts} retryLabel={tr.text("record.card.retry")} />
            {/* Item 8a-2: under the facts line, never above it (G11); absent when the facts failed (plan deviation 15). */}
            <AiSummary url={aiSummaryUrl} labels={{
              regenerate: tr.text("record.ai.regenerate"), retry: tr.text("record.card.retry"), failed: tr.text("record.ai.failed"),
              capped: tr.text("record.ai.capped"), writing: tr.text("record.ai.writing"),
            }} />
          </div>
        ),
      }
      : failed(tr.text("record.summary.failed")),
    "next-up": upNext
      // Add a To-do focuses the timeline's To-do field: with no timeline there is nothing behind it (D3).
      ? {
        node: (
          <NextUpBody view={upNext} emptyText={tr.text("record.nextUp.empty")} addTodoLabel={composerShown ? tr.text("record.nextUp.addTodo") : null}
            // Shown only beside What's next's own rows: when that read fails, the card's error stands alone
            // (plan ambiguity 7). Each action is bound to this account (plan fix I-3).
            waiting={
              <WaitingSuggestions tr={tr} data={waitingData} seeAllHref={`/dashboard/accounts/${accountId}/tasks`}
                accept={acceptSuggestionAction.bind(null, accountId)}
                editAccept={editAcceptSuggestionAction.bind(null, accountId)}
                discard={discardSuggestionAction.bind(null, accountId)}
                undo={undoSuggestionAction.bind(null, accountId)} />
            } />
        ),
      }
      : failed(tr.text("record.nextUp.failed")),
    // 1b: bilingual (no lang="en" wrapper), one server page, every row marked.
    timeline: timeline.status === "ready" && timelineView
      ? {
        node: (
          <ActivityTimeline
            accountId={accountId}
            contactId={contactId}
            contactHasEmail={Boolean(contact.email)}
            // The same e164Of notion of "usable" sendSmsAction gates on, so SMS fails up front.
            contactHasPhone={Boolean(e164Of(contact.phone))}
            smsGate={smsGate}
            smsBlockedLine={smsBlockedLine}
            emailNoticeLine={composerEmailNotice(emailRecipient, zone.zone, locale)}
            emailAction={sendEmailAction.bind(null, accountId)}
            smsAction={sendSmsAction.bind(null, accountId)}
            timezone={zone.zone}
            canAssign={assign.canAssign}
            members={assign.members}
            rows={timelineView}
            holdOpenTaskIds={timeline.holdOpen}
            customerLang={(contact.language as "en" | "es" | null) ?? ""}
            failedText={timelineFailedText(timeline.page.failed, tr)}
            // Rule 5's empty state only on the head, and only when nothing failed: a failed source is not "nothing".
            emptyText={!before && timelineView.length === 0 && timeline.page.failed.length === 0 ? tr.text("timeline.empty") : null}
            // Task 9: a page where a source failed offers no Older (its cursor would skip that source's rows).
            pager={timelinePagerHrefs({
              basePath: `/dashboard/accounts/${accountId}/contacts/${contactId}`,
              older: timeline.page.older, paged: Boolean(before), failed: timeline.page.failed, locale: localeParam,
            })}
            tr={tr}
          />
        ),
      }
      : failed(tr.text("record.activity.failed")),
    // The Groups card's copy stays English (S-03 part 3 D10; spec §16 files its translation).
    groups: { node: <div lang="en"><GroupsCard accountId={accountId} contactId={contactId} canManageGroups={assign.canAssign} headingHidden /></div> },
    properties: { node: <PlacesCard accountId={accountId} contactId={contactId} canMovePlace={assign.canAssign} headingHidden /> },
    deals: deals.status === "ready" ? { node: <DealsBody deals={deals.deals} tr={tr} /> } : cardFailed("record.card.deals"),
    documents: {
      node: <DocumentsCard accountId={accountId} record={{ kind: "contact", id: contactId }} canManage={access.canManage}
        emptyText={tr.text("documents.empty.contact")} name={rawName}
        // S-07 2c (D1): everyone who sees the customer sees the required list; only the whole account's view changes it.
        checklist={{ canSkip: seesWholeAccount(access) }} {...(focus ? { focus } : {})} />,
      // S-07 3a (review I2, orchestrator ruling): a link that names a file opens this card on a phone, so the file can be focused.
      defaultOpen: Boolean(focus?.documentId),
    },
    // S-03 part 3 (D10): Details and Tags are bilingual, so they inherit the page's lang.
    details: fieldDefs.status === "ready"
      ? {
        node: (
          <ContactDetailsBody accountId={accountId} contactId={contactId} contact={contact} fieldDefs={fieldDefs.fieldDefs}
            email={email} texts={texts} canAssign={assign.canAssign} members={assign.members} viewerId={assign.personId}
            language={language} forwarding={forwarding} />
        ),
      }
      : cardFailed("contact.details"),
    tags: tags.status === "ready"
      ? { node: <ContactTagsBody accountId={accountId} contactId={contactId} tags={tags.tags} /> }
      : cardFailed("contact.tags"),
    "related-people": { node: <RelationshipsCard accountId={accountId} contactId={contactId} headingHidden /> },
  } satisfies Record<RecordCardId, Slot>;

  const columns = columnRuns(RECORD_CARDS).map(({ column, cards }) => ({
    column,
    content: cards.map((def) => {
      const slot: Slot = slots[def.id];
      return (
        <RecordCard key={def.id} id={def.id} title={tr.text(def.titleKey)} collapsibleOnPhone={def.collapsibleOnPhone}
          skeletonRows={def.skeletonRows} state={slot.state ?? "ready"} errorText={slot.errorText} defaultOpen={slot.defaultOpen}>
          {slot.node}
        </RecordCard>
      );
    }),
  }));

  return (
    // The page's own locale reaches the client cards too (a `?locale=` QA override the layout never sees).
    <LocaleProvider locale={locale}>
      <RecordLayout
        lang={locale}
        skipLabel={tr.text("record.skipToDetails")}
        header={<RecordHeader name={name} subtitle={subtitle} actions={actions}
          // S-03 part 2b (§8.9, R2): the main group's words open its own page.
          subtitleHref={mainGroup ? `/dashboard/accounts/${accountId}/groups/${mainGroup.id}` : undefined}
          back={{ href: `/dashboard/accounts/${accountId}/contacts`, label: tr.text("record.back") }} />}
        columns={columns}
      />
    </LocaleProvider>
  );
}
