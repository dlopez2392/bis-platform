import type { listMessages } from "@bis/db";
import type { EmailView } from "@/lib/consent/email-view";
import { formatDateTimeInZone } from "@/lib/format";
import { MESSAGE_STATUS_LABEL, messageChannelLabel } from "@/lib/labels";
import { messageFailureReason } from "@/lib/email/failure-reason";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/locale";
// Fix round 1 (UI review, critical): `readInboundMeta` moved to the plain `./inbound-meta`
// module. This file is a SERVER component — `inbound-notice.tsx` is `"use client"`, and
// calling a non-component export of a client module from server code throws at runtime
// ("Attempted to call readInboundMeta() from the server"), a failure vitest's own render
// never surfaces because it does not apply Next's RSC transform (pinned by the import-site
// scan in `inbound-meta.test.ts`).
import { readInboundMeta } from "./inbound-meta";
import { InboundNotice } from "./inbound-notice";
import { currentStopState } from "./inbound-notice-state";

type Message = Awaited<ReturnType<typeof listMessages>>[number];

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
   *  own request-client (RLS) read. A bubble with no `meta.sender` at all
   *  is the thread's own contact, already proven visible by the page
   *  itself before any message loaded, so it needs no entry here. */
  visibleSenderIds: ReadonlySet<string>;
  /** Fix round 1 (UI review, important #2): each involved contact's CURRENT
   *  email-consent state (`lib/consent/email-view.ts`'s `EmailView`), keyed
   *  by contact id — `page.tsx`'s own server read (`readEmailView`), so a
   *  bubble's stop notice reflects reality now, not its filing-time
   *  snapshot. Missing an entry (not visible, no email on file, or the
   *  read failed) reads as "nothing current to show" (fail closed). */
  emailViews: ReadonlyMap<string, EmailView>;
}) {
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
        {messages.map((message) => (
          <div
            key={message.id}
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
            {/* S-09 §9: what the CUSTOMER wrote (inbound, never the voice channel's AI summary) carries
                their language; with none it is typed text of unknown language. Outbound is unchanged. */}
            {(() => {
              const typedLang = message.direction === "inbound" && message.channel !== "voice" ? (contactLanguage ?? "") : undefined;
              return (
                <>
                  {message.subject ? <p lang={typedLang} className="text-sm font-medium text-card-foreground">{message.subject}</p> : null}
                  <p lang={typedLang} className="whitespace-pre-wrap text-sm text-card-foreground">{message.body}</p>
                </>
              );
            })()}
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateTimeInZone(message.created_at, timezone)}
              {message.channel !== "email" ? (
                // `message.channel` is a raw DB string (untyped Supabase
                // client, no generated schema types) — messageChannelLabel
                // (lib/labels.ts) is the one place that widens it against the
                // exhaustive channel map, with a fallback for anything
                // outside it (e.g. "note", never actually written to this
                // table; see messaging.ts).
                <> · {messageChannelLabel(message.channel)}</>
              ) : null}
              {message.direction === "outbound" ? (
                <> · {MESSAGE_STATUS_LABEL[message.status] ?? message.status}</>
              ) : null}
            </p>
            {/* D-017: the thread recorded WHY an outbound message bounced or
                failed (messages.error) and never showed it — the dot-and-word
                status alone told an operator something went wrong, never
                what to tell the customer. Plain language only
                (messageFailureReason never echoes the raw, provider-worded
                column). */}
            {message.direction === "outbound" && messageFailureReason(message) ? (
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
              );
            })()}
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--row-line)] p-4">{composer}</div>
    </div>
  );
}
