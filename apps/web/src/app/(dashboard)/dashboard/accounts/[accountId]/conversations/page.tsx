import { MessagesSquare } from "lucide-react";
import { listConversations, getConversationSummary, listMessages, getContact } from "@bis/db";
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
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { readEmailView, type EmailView } from "@/lib/consent/email-view";
import { loggableError } from "@/lib/loggable-error";
import { m } from "@/lib/messages";
import { readInboundMeta } from "./inbound-meta";
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
  const [conversations, account, prefs] = await Promise.all([
    listConversations(db, accountId, { limit: PAGE_SIZE, before: cursor, assignee: assign.assignee }),
    // The zone every row's own timestamp renders in below, and the account's
    // own default language (Task 11's locale resolution) — not a throw: one
    // cosmetic date column must not take the whole inbox down, same reasoning
    // as the contacts list's own read (D-010).
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    getPersonPrefs(),
  ]);
  if (account.error) {
    console.error(`conversations: account ${accountId} timezone and language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language });
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
  // Orchestrator ruling (Task 11, visibility): a Technician may not act for a household member
  // they cannot see. Every distinct `meta.sender.contact_id` this thread's own messages carry,
  // checked under the REQUEST client (0068's own RLS scope) — an id that comes back is visible
  // to this viewer; one that does not (a Technician's own customers only) is withheld from the
  // bubble's Undo/Stop-emails button, even though the status text itself still shows.
  const senderIds = Array.from(new Set(
    messages.flatMap((message) => {
      const senderId = (message.meta as { sender?: { contact_id?: string } } | null)?.sender?.contact_id;
      return senderId ? [senderId] : [];
    }),
  ));
  let visibleSenderIds = new Set<string>();
  if (senderIds.length > 0) {
    const { data: visible, error: visibleError } = await db.from("contacts").select("id")
      .eq("account_id", accountId).in("id", senderIds);
    if (visibleError) {
      console.error(`conversations: account ${accountId} sender-visibility read failed: ${visibleError.message}`);
    } else {
      visibleSenderIds = new Set((visible ?? []).map((row) => (row as { id: string }).id));
    }
  }
  // Fix round 1 (UI review, important #2): the notice must reflect the stop's CURRENT state,
  // not the filing-time snapshot `meta.consent` carries — a staff Undo, a later event, or the
  // 7-day staff-Undo window (lib/consent/email-view.ts's REPLY_STOP_WINDOW_MS) may have moved
  // past it since. Bounded to only the contacts a filed reply actually names something about
  // (never "none"): the thread's own contact when a message with no sender carries one, or a
  // household member's when a message's own `meta.sender` does. Each contact is proven on the
  // REQUEST client (getContact, 0068's own RLS scope) before its ledger history is read at all;
  // an error or a filtered-out contact leaves it OUT of `emailViews` — fail closed, same as
  // `visibleSenderIds` above — never a thrown page.
  const now = new Date();
  const consentContactIds = Array.from(new Set(
    messages.flatMap((message) => {
      if (message.direction !== "inbound" || message.channel !== "email") return [];
      const parsed = readInboundMeta(message.meta);
      if (!parsed || parsed.consent.kind === "none") return [];
      const senderId = (message.meta as { sender?: { contact_id?: string } } | null)?.sender?.contact_id;
      return senderId ? [senderId] : active ? [active.contactId] : [];
    }),
  ));
  const emailViews = new Map<string, EmailView>();
  if (consentContactIds.length > 0) {
    const ledger = ledgerDb();
    await Promise.all(consentContactIds.map(async (id) => {
      try {
        const contact = await getContact(db, accountId, id);
        if (!contact?.email) return;
        emailViews.set(id, await readEmailView(ledger, accountId, contact, now));
      } catch (e) {
        console.error(`conversations: account ${accountId} contact ${id} email-view read failed: ${loggableError(e)}`);
      }
    }));
  }

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
              contactLanguage={active.contactLanguage}
              accountId={accountId}
              conversationId={active.id}
              contactId={active.contactId}
              locale={locale}
              visibleSenderIds={visibleSenderIds}
              emailViews={emailViews}
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
