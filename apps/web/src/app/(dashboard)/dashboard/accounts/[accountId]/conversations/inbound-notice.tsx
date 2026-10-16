"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { runGuarded } from "@/lib/ui/guarded-run";
import { undoReplyStopAction, stopEmailsFromReplyAction } from "./inbound-actions";
import { runUndoReplyStop, runStopEmailsFromReply } from "./inbound-notice-handlers";

/**
 * The thread bubble's inbound-email details (S-06 part 1, Task 11): who sent
 * it (a household member's name, when there was one — `file.ts` only sets
 * `meta.sender` for a member reached via a group), how many attachments
 * landed (not yet saved anywhere, so staff know to ask again if one
 * mattered), and either the emailed stop (dot + word, rule 3, a ghost Undo)
 * or the "May want to stop" chip (dot + word, a ghost "Stop emails").
 * Nothing when there is nothing to say (an inbound email with no sender, no
 * attachments and no consent news at all).
 */
export type InboundMeta = {
  attachmentCount: number;
  sender: { name: string } | null;
  consent: { kind: "stopped"; eventId: string } | { kind: "maybe" } | { kind: "none" };
};

type RawSender = { contact_id?: string; first_name?: string | null; last_name?: string | null } | null | undefined;
type RawConsent = { kind?: string; eventId?: string } | null | undefined;
type RawMeta = {
  inbound_email_id?: string;
  attachment_count?: number;
  sender?: RawSender;
  consent?: RawConsent;
};

/** `null` for any message that is not an inbound email (`file.ts` stamps `inbound_email_id` on
 *  every one it files; nothing else in `messages.meta` ever carries that key). */
export function readInboundMeta(meta: unknown): InboundMeta | null {
  if (!meta || typeof meta !== "object" || !("inbound_email_id" in meta)) return null;
  const raw = meta as RawMeta;
  const sender = raw.sender
    ? { name: [raw.sender.first_name, raw.sender.last_name].filter((part): part is string => Boolean(part)).join(" ") }
    : null;
  const consent: InboundMeta["consent"] =
    raw.consent?.kind === "stopped" && raw.consent.eventId
      ? { kind: "stopped", eventId: raw.consent.eventId }
      : raw.consent?.kind === "maybe"
        ? { kind: "maybe" }
        : { kind: "none" };
  return { attachmentCount: raw.attachment_count ?? 0, sender, consent };
}

export function InboundNotice({ meta, accountId, conversationId, contactId, locale, canAct }: {
  meta: InboundMeta;
  accountId: string;
  conversationId: string;
  contactId: string;
  locale: Locale;
  /** Orchestrator ruling (visibility): false when this bubble's own sender is a household
   *  member NOT in the viewer's visible set (`message-thread.tsx`'s own RLS-backed read,
   *  threaded down from `page.tsx`) — a Technician may not act for a customer they can't
   *  see. The status (dot + word) still renders; only the button that would write for that
   *  contact is withheld, same principle rule 3's dot-and-word already applies to status. */
  canAct: boolean;
}) {
  const router = useRouter();
  const [consent, setConsent] = useState(meta.consent);
  const [expired, setExpired] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  const dot = <span data-dot aria-hidden className="size-2 rounded-full bg-[var(--warn)]" />;

  let status: React.ReactNode = null;
  if (consent.kind === "stopped" && expired) {
    status = (
      <p data-reply-stopped className="flex items-center gap-2">
        {dot}
        {t(m, "conversations.reply.stopExpired", locale)}
      </p>
    );
  } else if (consent.kind === "stopped") {
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
    status = (
      <span data-reply-maybe className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-0.5">
        {dot}
        {t(m, "conversations.reply.maybeStop", locale)}
        {canAct ? (
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
      </span>
    );
  }

  const memberLine = meta.sender
    ? <p className="text-muted-foreground">{t(m, "conversations.reply.fromMember", locale, { name: meta.sender.name })}</p>
    : null;
  const attachmentsLine = meta.attachmentCount > 0
    ? <p className="text-muted-foreground">{plural(m, "conversations.reply.attachments", meta.attachmentCount, locale, { count: meta.attachmentCount })}</p>
    : null;

  if (!memberLine && !attachmentsLine && !status) return null;

  return (
    <div className="mt-1 space-y-1 text-xs">
      {memberLine}
      {attachmentsLine}
      {status}
    </div>
  );
}
