"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { m, type MessageKey } from "@/lib/messages";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { isSendRejected, sendRejectedReason } from "../../conversations/send-errors";
import { EmailSendButton } from "../../conversations/send-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { segmentsFor } from "@/lib/sms/segments";
import type { SmsGate } from "@/lib/sms/sender";

export type ComposeMode = "note" | "email" | "sms";
type Mode = ComposeMode;

/** The record header's Text/Email links (S-03 part 1, spec §9.1): `#compose-sms`, `#compose-email`. */
export function composeModeFromHash(hash: string): "email" | "sms" | null {
  if (hash === "#compose-sms") return "sms";
  if (hash === "#compose-email") return "email";
  return null;
}

/** The line the Text tab shows in place of its form, in today's order; null when the form shows.
 *  `consent` marks the recipient's own line (the one `data-testid="composer-sms-blocked"` names). */
export function smsFormBlock(
  gate: SmsGate | null, contactHasPhone: boolean, blockedLine: string | null, locale: Locale = "en",
): { text: string; consent: boolean } | null {
  if (gate === null) return { text: t(m, "compose.smsStateUnknown", locale), consent: false };
  if (!gate.ok) return { text: gate.reason === "a2p_not_approved" ? t(m, "compose.smsBlockedA2p", locale) : t(m, "compose.smsBlockedNoNumber", locale), consent: false };
  if (!contactHasPhone) return { text: t(m, "compose.noPhoneOnContact", locale), consent: false };
  return blockedLine ? { text: blockedLine, consent: true } : null;
}

export function MessageComposer({
  contactId,
  contactHasEmail,
  contactHasPhone,
  smsGate,
  smsBlockedLine,
  emailNoticeLine,
  noteAction,
  emailAction,
  smsAction,
}: {
  contactId: string;
  contactHasEmail: boolean;
  // Mirrors contactHasEmail: whether e164Of(contact.phone) resolves to a
  // usable number — the same notion sendSmsAction itself gates on. Without
  // this, SMS let an operator compose an entire text to a phone-less
  // contact and only fail on submit, where email already blocks up front.
  contactHasPhone: boolean;
  // Resolved on the SERVER (the contact page is a server component) and
  // passed in as a prop — this composer is a client component and must not
  // query the database itself. `resolveSmsSender` is THE gate; nothing here
  // re-derives it.
  // null: the gate read failed (spec §7); the Text tab says so, never an open form.
  smsGate: SmsGate | null;
  // The recipient's consent line (spec §6), decided on the server from the
  // same two facts the send gate reads: texts stopped, on hold, or a number
  // that could be Mexican or US. The form is not rendered while it is set;
  // the action says the same line after an attempt from a stale tab.
  smsBlockedLine: string | null;
  // The email composer's one line (spec §6, choice 22): set when the
  // contact's email is stopped. The form STILL shows — a person replying
  // about their own matter is not automated mail.
  emailNoticeLine: string | null;
  noteAction: (formData: FormData) => Promise<void>;
  emailAction: (formData: FormData) => Promise<void>;
  smsAction: (formData: FormData) => Promise<void>;
}) {
  const locale = useLocale();
  const tx = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const [mode, setMode] = useState<Mode>("note");
  // Controlled, not a plain uncontrolled Input, so the segment counter below
  // can recompute on every keystroke.
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<Mode>(mode);
  const [focusNonce, setFocusNonce] = useState(0);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // The record header's Text and Email (spec §9.1): open on that channel and focus the body. A
  // hashchange covers a deep link and a first click; the click listener covers clicking the same
  // link twice (no hashchange then). Only the note boundary clears the draft, as the tabs do.
  useEffect(() => {
    const open = (hash: string) => {
      const target = composeModeFromHash(hash);
      if (!target) return;
      const current = modeRef.current;
      if (target !== current) {
        setMode(target);
        if (current === "note") setBody("");
      }
      setFocusNonce((n) => n + 1);
    };
    const onHash = () => open(window.location.hash);
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href^='#compose-']");
      if (link) open(link.getAttribute("href") ?? "");
    };
    // Deferred, not called in the effect body: React's set-state-in-effect rule, and the page's
    // own hash is read after hydration either way.
    const first = window.setTimeout(onHash, 0);
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
  useEffect(() => { if (focusNonce > 0) bodyRef.current?.focus(); }, [focusNonce]);
  const isEmail = mode === "email";
  const isSms = mode === "sms";
  const smsBlock = isSms ? smsFormBlock(smsGate, contactHasPhone, smsBlockedLine, locale) : null;

  const { pending, onSubmit } = useFormSubmit(async (formData, form) => {
    try {
      await (isEmail ? emailAction : isSms ? smsAction : noteAction)(formData);
      if (isEmail) toast.success(tx("compose.sent"));
      if (isSms) toast.success(tx("compose.smsSent"));
      // Clear for the next message — what React's reset used to do, now
      // explicit and ONLY on success. On failure the draft must survive: a
      // rejected send used to wipe the note or message the operator had just
      // typed, at the worst possible moment to lose it.
      if (form.isConnected) {
        form.reset();
        setBody("");
      }
    } catch (e) {
      if (isSms) {
        // Carries the ACTUAL reason sendSmsAction produced (already curated,
        // plain-language m[] copy for every gate it can throw —
        // compose.smsBlockedA2p / compose.smsBlockedNoNumber /
        // compose.noPhoneOnContact) rather than one fixed string. A fixed
        // "check the contact has a phone number" line is wrong for the two
        // GATE rejections a stale tab can still hit past the contactHasPhone
        // check above: A2P revoked, or the number went unassigned, between
        // this page rendering and the send landing.
        toast.error(isSendRejected(e)
          ? (sendRejectedReason(e) ?? tx("compose.smsSendRejected")) : tx("compose.smsFailed"));
      } else if (!isEmail) {
        toast.error(tx("compose.noteFailed"));
      } else {
        toast.error(isSendRejected(e) ? tx("compose.sendRejected") : tx("compose.sendFailed"));
      }
    }
  });

  return (
    <div className="w-full space-y-2">
      <span id="compose-sms" className="block scroll-mt-24" aria-hidden />
      <span id="compose-email" className="block scroll-mt-24" aria-hidden />
      <div className="flex gap-1">
        {(["note", "email", "sms"] as const).map((value) => (
          <button
            key={value}
            type="button"
            // The Text tab stays enabled even when SMS is gated off (danlo's
            // call): switching to it is how the operator SEES the reason, in
            // place of the form below, rather than a disabled tab that hides
            // it entirely.
            onClick={() => {
              if (value === mode) return;
              setMode(value);
              // A controlled body survives an uncontrolled `key={mode}`
              // remount — without this, an internal note typed, then a
              // switch to Text, sends the note's text as the outbound SMS.
              // Only the note boundary is the hazard: clear when a note is
              // entered or left, not on every tab switch (that would wipe an
              // in-progress email/SMS draft on a zero-intent re-click or a
              // switch between the two send modes).
              if (mode === "note" || value === "note") setBody("");
            }}
            aria-pressed={mode === value}
            className={cn(
              "min-h-11 md:min-h-8 rounded-[var(--radius-ctl)] px-2.5 py-1 text-xs font-medium transition-colors",
              mode === value
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "note" ? tx("compose.note") : value === "email" ? tx("compose.email") : tx("compose.sms")}
          </button>
        ))}
      </div>

      {isEmail && !contactHasEmail ? (
        <p className="text-xs text-muted-foreground">{tx("compose.noEmailOnContact")}</p>
      ) : smsBlock ? (
        <p className="text-xs text-muted-foreground" data-testid={smsBlock.consent ? "composer-sms-blocked" : undefined}>{smsBlock.text}</p>
      ) : (
        <form
          key={mode}
          // onSubmit, NOT the `action` prop — see lib/forms/use-form-submit.ts.
          onSubmit={onSubmit}
          className="space-y-2"
          aria-label={isEmail ? tx("compose.email") : isSms ? tx("compose.sms") : tx("compose.note")}
        >
          <input type="hidden" name="contactId" value={contactId} />
          {isEmail && emailNoticeLine ? (
            <p role="note" className="text-xs text-muted-foreground" data-testid="composer-email-notice">{emailNoticeLine}</p>
          ) : null}
          {isEmail ? (
            <Input name="subject" placeholder={tx("compose.subject")} className="text-sm" />
          ) : null}
          {/* Textarea, not a single-line Input (D-015): an `<input>` cannot
              hold a typed Enter at all, so no note, email or text sent from
              here could ever carry a paragraph break. Enter inserts a
              newline, as a textarea always does — nothing here intercepts
              it — so the button below is the one way to submit. */}
          <Textarea
            ref={bodyRef}
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              isEmail ? tx("compose.emailPlaceholder")
                : isSms ? tx("compose.smsPlaceholder")
                  : tx("contact.addNote")
            }
            rows={isEmail || isSms ? 3 : 2}
            required
          />
          <div className="flex items-center justify-between gap-2">
            {isSms ? (
              <p className="text-xs text-muted-foreground">
                {tx("compose.smsSegments", { chars: segmentsFor(body).chars, segments: segmentsFor(body).segments })}
              </p>
            ) : <span />}
            {/* Disables while pending. The note form this replaced had that
                protection via SubmitButton; sending is the slowest action in
                the app and the only one that texts or mails a real person, so
                a double-click here costs a duplicate send. */}
            <EmailSendButton
              label={isEmail || isSms ? tx("compose.send") : tx("common.add")}
              pendingLabel={isEmail || isSms ? tx("compose.sending") : tx("common.saving")}
              variant={isEmail || isSms ? "default" : "outline"}
              pending={pending}
            />
          </div>
        </form>
      )}
    </div>
  );
}
