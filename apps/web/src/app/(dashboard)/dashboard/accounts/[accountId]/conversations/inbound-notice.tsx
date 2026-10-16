"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { runGuarded } from "@/lib/ui/guarded-run";
import type { InboundMeta } from "./inbound-meta";
import { undoReplyStopAction, stopEmailsFromReplyAction } from "./inbound-actions";
import { runUndoReplyStop, runStopEmailsFromReply } from "./inbound-notice-handlers";

export type { InboundMeta };

/**
 * The thread bubble's inbound-email details (S-06 part 1, Task 11): who sent
 * it (a household member's name, when there was one — `file.ts` only sets
 * `meta.sender` for a member reached via a group), how many attachments
 * landed (not yet saved anywhere, so staff know to ask again if one
 * mattered), and either the emailed stop (dot + word, rule 3, a ghost Undo)
 * or the "May want to stop" chip (dot + word, a ghost "Stop emails").
 * Nothing when there is nothing to say (an inbound email with no sender, no
 * attachments and no consent news at all). `readInboundMeta` moved to the
 * plain `./inbound-meta` module (fix round 1) so the server component that
 * reads it (`message-thread.tsx`) never calls into this `"use client"` file.
 */
export function InboundNotice({
  meta, accountId, conversationId, contactId, locale, canAct, stopIsCurrent, initiallyExpired, chipActionable,
}: {
  meta: InboundMeta;
  accountId: string;
  conversationId: string;
  contactId: string;
  locale: Locale;
  /** Orchestrator ruling (visibility): false when this bubble's own sender is a household
   *  member NOT in the viewer's visible set — `page.tsx`'s own `getContact` read on the
   *  request client (0068's RLS), the SAME call that produces `stopIsCurrent`'s own
   *  `EmailView` (fix round 2: one visibility path, not a second query), threaded down
   *  through `message-thread.tsx`. For the "maybe" chip this withholds only its "Stop
   *  emails" button — the chip's own dot-and-word always shows (rule 3), because it is
   *  historical information this reply carried, not a live write. For a STOPPED reply,
   *  `canAct` on its own never has to hide the status text: a contact this flag excludes
   *  also never got an `EmailView` built for it (`page.tsx` skips `readEmailView` once
   *  `getContact` answers null), so `stopIsCurrent` is already false and the WHOLE notice
   *  is gone before `canAct` is even consulted — stricter than the original ruling
   *  ("status still shows, button withheld"), decided and accepted in fix round 2. */
  canAct: boolean;
  /** Fix round 1 (UI review, important): true only when this message's OWN stop (its
   *  `consent.eventId`) is still the newest consent row for the address AND was recorded by
   *  an inbound-email reply — `message-thread.tsx`'s own `currentStopState` (server-computed
   *  from `lib/consent/email-view.ts`'s `readEmailView`). False after a staff Undo, or once a
   *  LATER event has superseded this one: the whole stop notice then renders nothing at all,
   *  because this bubble's own filing-time snapshot is no longer the truth. */
  stopIsCurrent: boolean;
  /** Only meaningful when `stopIsCurrent`: the owner's 7-day staff-Undo window
   *  (`REPLY_STOP_WINDOW_MS`) has already closed as of the SERVER's render — computed
   *  there, never guessed client-side, so there is no hydration mismatch. */
  initiallyExpired: boolean;
  /** Only meaningful for the "maybe" chip: true while the address is CURRENTLY allowed
   *  (`EmailView.kind === "allowed"`) — the chip's dot-and-word always shows (it is the
   *  historical signal this reply carried), but its "Stop emails" button only while there
   *  is still something to stop. */
  chipActionable: boolean;
}) {
  const router = useRouter();
  const [consent, setConsent] = useState(meta.consent);
  // Server-computed (`stopIsCurrent`/`initiallyExpired`, fix round 1): no client-side guess at
  // mount, so no hydration mismatch. `expired` still flips reactively — a race where the 7-day
  // window closes BETWEEN this render and a click — read off the server's own typed `expired`
  // field on that later attempt, never matched against its (translatable) error string.
  const [expired, setExpired] = useState(initiallyExpired);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  const dot = <span data-dot aria-hidden className="size-2 rounded-full bg-[var(--warn)]" />;

  let status: React.ReactNode = null;
  // Fix round 1 (important): a stop that is no longer CURRENT — a staff Undo already lifted it,
  // or a later event superseded it — renders nothing at all. Showing "Stopped..." (or its Undo)
  // for a row that is no longer true would be stale information, not merely a withheld button.
  if (consent.kind === "stopped" && stopIsCurrent && expired) {
    // Minor 2 (fix round 2): two sentences, never run together with just a space — a middle
    // dot separates them, the same convention `conversations.reply.stopped` itself already
    // uses internally ("Stopped marketing emails · from their reply").
    status = (
      <p data-reply-stopped className="flex items-center gap-2">
        {dot}
        {t(m, "conversations.reply.stopped", locale)}
        {" · "}
        {t(m, "conversations.reply.stopExpired", locale)}
      </p>
    );
  } else if (consent.kind === "stopped" && stopIsCurrent) {
    const eventId = consent.eventId;
    status = (
      <p data-reply-stopped className="flex items-center gap-2">
        {dot}
        {t(m, "conversations.reply.stopped", locale)}
        {canAct ? (
          <Button
            variant="ghost" size="sm" className="min-h-11 md:min-h-8" disabled={pending} aria-busy={pending}
            onClick={() => runGuarded(busy, startTransition, () => runUndoReplyStop(
              () => undoReplyStopAction(accountId, conversationId, eventId),
              toast, locale,
              (wasExpired) => {
                if (wasExpired) { setExpired(true); return; }
                setConsent({ kind: "none" });
                router.refresh();
              },
            ))}
          >
            {t(m, "common.undo", locale)}
          </Button>
        ) : null}
      </p>
    );
  } else if (consent.kind === "maybe") {
    // Minor 7 (fix round 1): the "Stop emails" button sits BESIDE the chip, not inside it, so
    // the chip itself stays a compact pill on a phone rather than growing to fit a button.
    status = (
      <p className="flex flex-wrap items-center gap-2">
        <span data-reply-maybe className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-0.5">
          {dot}
          {t(m, "conversations.reply.maybeStop", locale)}
        </span>
        {canAct && chipActionable ? (
          <Button
            variant="ghost" size="sm" className="min-h-11 md:min-h-8" disabled={pending} aria-busy={pending}
            onClick={() => runGuarded(busy, startTransition, () => runStopEmailsFromReply(
              () => stopEmailsFromReplyAction(accountId, conversationId, contactId),
              toast, locale,
              () => {
                setConsent({ kind: "none" });
                router.refresh();
              },
            ))}
          >
            {t(m, "contact.email.stopEmails", locale)}
          </Button>
        ) : null}
      </p>
    );
  }

  // Minor 4 (fix round 1): a household member with no stored name reuses `contactDisplayName`'s
  // own fallback key, localized (the raw reader can't localize — it has no `locale`).
  const memberLine = meta.sender
    ? <p className="text-muted-foreground">
        {t(m, "conversations.reply.fromMember", locale, { name: meta.sender.name.trim() || t(m, "contact.noName", locale) })}
      </p>
    : null;
  const attachmentsLine = meta.attachmentCount > 0
    ? <p className="text-muted-foreground">{plural(m, "conversations.reply.attachments", meta.attachmentCount, locale, { count: meta.attachmentCount })}</p>
    : null;

  if (!memberLine && !attachmentsLine && !status) return null;

  // Fix round 1 (important, item 3): the reader's own language, so a screen reader and the
  // pseudo-locale sweep both read this fragment correctly even though the surrounding bubble
  // (the customer's own typed words) may carry a DIFFERENT `lang` (S-09 §9).
  return (
    <div lang={locale} className="mt-1 space-y-1 text-xs">
      {memberLine}
      {attachmentsLine}
      {status}
    </div>
  );
}
