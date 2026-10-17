import { Fragment } from "react";
import type { listMessages } from "@bis/db";
import type { EmailView } from "@/lib/consent/email-view";
import { formatDateTimeInZone } from "@/lib/format";
import { messageChannelLabel } from "@/lib/labels";
import { messageFailureReason } from "@/lib/email/failure-reason";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/locale";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { authorLabel } from "@/lib/record/author-mark";
import { makeTr } from "@/lib/record/copy";
// Fix round 1 (UI review, critical): `readInboundMeta` moved to the plain `./inbound-meta`
// module. This file is a SERVER component — `inbound-notice.tsx` is `"use client"`, and
// calling a non-component export of a client module from server code throws at runtime
// ("Attempted to call readInboundMeta() from the server"), a failure vitest's own render
// never surfaces because it does not apply Next's RSC transform (pinned by the import-site
// scan in `inbound-meta.test.ts`).
import { readInboundMeta } from "./inbound-meta";
import { InboundNotice } from "./inbound-notice";
import { currentStopState } from "./inbound-notice-state";
import { readWebchatMeta, firstWebchatRows } from "./webchat-meta";

type Message = Awaited<ReturnType<typeof listMessages>>[number];

/** G26: the status word in the staff member's language (conversations.status.* carry .es); a value outside
 *  the six prints as itself, as MESSAGE_STATUS_LABEL's `?? message.status` did. */
const STATUS_KEY: Readonly<Record<string, MessageKey>> = {
  queued: "conversations.status.queued", sent: "conversations.status.sent", delivered: "conversations.status.delivered",
  opened: "conversations.status.opened", bounced: "conversations.status.bounced", failed: "conversations.status.failed",
};

export function MessageThread({
  messages,
  contactName,
  composer,
  timezone,
  contactLanguage,
  accountId,
  conversationId,
  contactId,
  locale,
  visibleSenderIds,
  emailViews,
  forwardedNames,
  personaName,
}: {
  messages: Message[];
  contactName: string;
  composer: React.ReactNode;
  /** The account's RESOLVED zone (`renderZone`, computed once by `page.tsx`)
   *  — same bug, same fix, as `conversation-list.tsx`'s own `timezone` prop:
   *  every bubble's timestamp rendered in the RUNTIME's zone, never the
   *  account's. */
  timezone: string;
  /** S-09 §9: the customer's language for their own words; null when not set. */
  contactLanguage: "en" | "es" | null;
  /** Task 11 (S-06 part 1): threaded to each bubble's InboundNotice. Its
   *  actions prove the conversation and build their context for the right
   *  contact — this thread's own, UNLESS a given bubble's own
   *  `meta.sender.contact_id` names a household member instead. */
  accountId: string;
  conversationId: string;
  contactId: string;
  locale: Locale;
  /** Orchestrator ruling (visibility): the set of this thread's own
   *  `meta.sender.contact_id`s the viewer can actually see — `page.tsx`'s
   *  own `getContact` read on the request client (0068's RLS), the SAME
   *  call that builds `emailViews` below (fix round 2: one visibility
   *  path, not a second query). A bubble with no `meta.sender` at all is
   *  the thread's own contact, already proven visible by the page itself
   *  before any message loaded, so it needs no entry here. Fix round 2
   *  (stricter than the original ruling, decided and accepted): because a
   *  hidden contact never gets an `emailViews` entry either (`page.tsx`
   *  skips `readEmailView` once `getContact` answers null), a STOPPED
   *  reply's whole notice disappears for a bubble this set excludes — not
   *  merely its button — since `currentStopState` below has no view to
   *  match against. Only the "maybe" chip still shows its own dot-and-word
   *  regardless; this set, combined with `chipActionable`, withholds only
   *  ITS button. */
  visibleSenderIds: ReadonlySet<string>;
  /** Fix round 1 (UI review, important #2): each involved contact's CURRENT
   *  email-consent state (`lib/consent/email-view.ts`'s `EmailView`), keyed
   *  by contact id — `page.tsx`'s own server read (`readEmailView`), so a
   *  bubble's stop notice reflects reality now, not its filing-time
   *  snapshot. Missing an entry (not visible, no email on file, or the
   *  read failed) reads as "nothing current to show" (fail closed). */
  emailViews: ReadonlyMap<string, EmailView>;
  /** S-06 part 2 (spec §1, G4): who forwarded a filed forward — Clerk id to name, read by
   *  `page.tsx` with `listPeopleNames` on the REQUEST client, so a person the reader cannot see
   *  stays unnamed. A missing id (or a forward with none) reads "someone on the team". */
  forwardedNames: ReadonlyMap<string, string>;
  /** S-06 part 3 (spec §5): the receptionist's name on her web chat bubbles, read by page.tsx only when the thread holds one; null or absent reads "Sofía" (authorLabel's own fallback). */
  personaName?: string | null;
}) {
  const tr = makeTr(locale);
  const firstChatRows = firstWebchatRows(messages);
  const statusWord = (s: string) => (Object.hasOwn(STATUS_KEY, s) ? t(m, STATUS_KEY[s]!, locale) : s);
  return (
    // The thread pane is bounded to the viewport (topbar h-14 = 56px + the
    // title-only PageHeader here = 69px + the conversations grid's p-6 top/
    // bottom padding = 48px) only from `lg` up, where the two-column layout
    // applies — that's what lets the inner overflow-y-auto region actually
    // engage instead of growing the whole page. Below `lg` the panes stack,
    // where a fixed cap would look wrong, so it's left unbounded there.
    // The blur is on the CARD, not on the rows — this pane scrolls internally
    // (the region below) and the mockup's own note only warns off blurring the
    // long list itself, which is why the bubbles stay flat.
    <div className="flex flex-col rounded-xl border border-border bg-card glass lg:max-h-[calc(100vh-173px)]">
      <div className="border-b border-[var(--row-line)] px-4 py-3">
        <p className="text-[13.5px] font-semibold text-card-foreground">{contactName}</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => {
          // S-06 part 3 (spec §5): a lead's website chat turn. Its words carry the language they CHATTED in
          // (one message, one language); its footer names the channel and the mark (one mark set with the
          // record, DESIGN.md Provenance) and never a status word: no one on the team sent it. The CHANNEL
          // makes it a chat row (fix round 1, M-5); the meta only adds its language, its index and the match.
          const isChat = message.channel === "webchat";
          const chat = isChat ? readWebchatMeta(message.meta) : null;
          // S-09 §9: what the CUSTOMER wrote (inbound, never the voice channel's AI summary) carries
          // their language; with none it is typed text of unknown language. Outbound is unchanged.
          const typedLang = chat ? chat.locale
            : message.direction === "inbound" && message.channel !== "voice" ? (contactLanguage ?? "") : undefined;
          const mark = isChat
            ? authorLabel(message.author_kind === "ai" ? "ai" : "customer", null, { viewerId: null, names: {}, personaName: personaName ?? null, tr })
            : null;
          return (
            <Fragment key={message.id}>
              {/* §5a: ONE line per chat matched to an existing customer, above its first row, in the staff
                  member's language. A fact about the match, not a status: no dot. */}
              {chat?.matchedExisting && firstChatRows.has(message.id) ? (
                <p lang={locale} data-webchat-unconfirmed="" className="text-xs text-muted-foreground">
                  {t(m, "conversations.webchat.unconfirmed", locale)}
                </p>
              ) : null}
              <div
                data-webchat-row={chat ? String(chat.index) : undefined}
                // Ladder step 2 inbound, `--accent-dim` outbound — the selection
                // colour the rest of the app uses. NEVER glass: there can be
                // hundreds of these in one thread. Outbound used to carry a raw
                // 10% alpha of the brand colour, which no token names.
                className={cn(
                  "max-w-[75%] rounded-[var(--radius-ctl)] px-3 py-2",
                  message.direction === "outbound"
                    ? "ml-auto bg-[var(--accent-dim)]"
                    : "bg-[var(--surface-2)]",
                )}
              >
                {message.subject ? <p lang={typedLang} className="text-sm font-medium text-card-foreground">{message.subject}</p> : null}
                <p lang={typedLang} className="whitespace-pre-wrap text-sm text-card-foreground">{message.body}</p>
                {/* G26: the footer in the STAFF member's language, every bubble's. */}
                <p lang={locale} className="mt-1 break-words text-xs text-muted-foreground">
                  {formatDateTimeInZone(message.created_at, timezone, locale)}
                  {message.channel !== "email" ? (
                    // `message.channel` is a raw DB string (untyped Supabase
                    // client, no generated schema types) — messageChannelLabel
                    // (lib/labels.ts) is the one place that widens it against the
                    // exhaustive channel map, with a fallback for anything
                    // outside it (e.g. "note", never actually written to this
                    // table; see messaging.ts).
                    <> · {messageChannelLabel(message.channel, locale)}</>
                  ) : null}
                  {mark ? <> · {mark}</> : message.direction === "outbound" ? <> · {statusWord(message.status)}</> : null}
                </p>
                {/* D-017: the thread recorded WHY an outbound message bounced or
                    failed (messages.error) and never showed it — the dot-and-word
                    status alone told an operator something went wrong, never
                    what to tell the customer. Plain language only
                    (messageFailureReason never echoes the raw, provider-worded
                    column). A chat row has no delivery to fail. */}
                {!isChat && message.direction === "outbound" && messageFailureReason(message) ? (
                  <p className="mt-1 text-xs text-[var(--crit)]">{messageFailureReason(message)}</p>
                ) : null}
                {/* Task 11 (S-06 part 1): who sent it, how many attachments, the
                    emailed stop or the May-want-to-stop chip — only for an
                    inbound email that `file.ts` actually filed as one. */}
                {(() => {
                  const meta = message.direction === "inbound" && message.channel === "email" ? readInboundMeta(message.meta) : null;
                  if (!meta) return null;
                  const senderId = (message.meta as { sender?: { contact_id?: string } } | null)?.sender?.contact_id;
                  const effectiveContactId = senderId ?? contactId;
                  // No sender at all means this bubble's address IS the thread's own contact —
                  // already proven visible by page.tsx before any message loaded. A sender
                  // (a household member) must be in the viewer's own visible set.
                  const canAct = !senderId || visibleSenderIds.has(senderId);
                  // Fix round 1 (important #2): the notice reflects the address's CURRENT
                  // consent state, not this message's own filing-time snapshot.
                  const { stopIsCurrent, initiallyExpired, chipActionable } =
                    currentStopState(meta.consent, emailViews.get(effectiveContactId));
                  return (
                    <>
                      {/* S-06 part 2: in the STAFF member's language (lang={locale}), because the
                          body above carries the customer's. */}
                      {meta.forwarded ? (
                        <p lang={locale} data-forwarded="" className="mt-1 text-xs text-muted-foreground">
                          {meta.forwarded.byId && forwardedNames.get(meta.forwarded.byId)
                            ? t(m, "conversations.forward.by", locale, { name: forwardedNames.get(meta.forwarded.byId)! })
                            : t(m, "conversations.forward.bySomeone", locale)}
                        </p>
                      ) : null}
                      <InboundNotice
                        meta={meta}
                        accountId={accountId}
                        conversationId={conversationId}
                        contactId={effectiveContactId}
                        locale={locale}
                        canAct={canAct}
                        stopIsCurrent={stopIsCurrent}
                        initiallyExpired={initiallyExpired}
                        chipActionable={chipActionable}
                      />
                    </>
                  );
                })()}
              </div>
            </Fragment>
          );
        })}
      </div>
      <div className="border-t border-[var(--row-line)] p-4">{composer}</div>
    </div>
  );
}
