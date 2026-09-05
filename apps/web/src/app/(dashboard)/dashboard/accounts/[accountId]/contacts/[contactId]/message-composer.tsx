"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { isSendRejected, sendRejectedReason } from "../../conversations/send-errors";
import { EmailSendButton } from "../../conversations/send-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { segmentsFor } from "@/lib/sms/segments";
import type { SmsGate } from "@/lib/sms/sender";

type Mode = "note" | "email" | "sms";

export function MessageComposer({
  contactId,
  contactHasEmail,
  contactHasPhone,
  smsGate,
  noteAction,
  emailAction,
  smsAction,
}: {
  contactId: string;
  contactHasEmail: boolean;
  // Mirrors contactHasEmail: whether toE164(contact.phone) resolves to a
  // usable number — the same notion sendSmsAction itself gates on. Without
  // this, SMS let an operator compose an entire text to a phone-less
  // contact and only fail on submit, where email already blocks up front.
  contactHasPhone: boolean;
  // Resolved on the SERVER (the contact page is a server component) and
  // passed in as a prop — this composer is a client component and must not
  // query the database itself. `resolveSmsSender` is THE gate; nothing here
  // re-derives it.
  smsGate: SmsGate;
  noteAction: (formData: FormData) => Promise<void>;
  emailAction: (formData: FormData) => Promise<void>;
  smsAction: (formData: FormData) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("note");
  // Controlled, not a plain uncontrolled Input, so the segment counter below
  // can recompute on every keystroke.
  const [body, setBody] = useState("");
  const isEmail = mode === "email";
  const isSms = mode === "sms";

  const { pending, onSubmit } = useFormSubmit(async (formData, form) => {
    try {
      await (isEmail ? emailAction : isSms ? smsAction : noteAction)(formData);
      if (isEmail) toast.success(m["compose.sent"]);
      if (isSms) toast.success(m["compose.smsSent"]);
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
          ? (sendRejectedReason(e) ?? m["compose.smsSendRejected"]) : m["compose.smsFailed"]);
      } else if (!isEmail) {
        toast.error(m["compose.noteFailed"]);
      } else {
        toast.error(isSendRejected(e) ? m["compose.sendRejected"] : m["compose.sendFailed"]);
      }
    }
  });

  return (
    <div className="w-full space-y-2">
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
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              mode === value
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "note" ? m["compose.note"] : value === "email" ? m["compose.email"] : m["compose.sms"]}
          </button>
        ))}
      </div>

      {isEmail && !contactHasEmail ? (
        <p className="text-xs text-muted-foreground">{m["compose.noEmailOnContact"]}</p>
      ) : isSms && !smsGate.ok ? (
        <p className="text-xs text-muted-foreground">
          {smsGate.reason === "a2p_not_approved"
            ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
        </p>
      ) : isSms && !contactHasPhone ? (
        <p className="text-xs text-muted-foreground">{m["compose.noPhoneOnContact"]}</p>
      ) : (
        <form
          key={mode}
          // onSubmit, NOT the `action` prop — see lib/forms/use-form-submit.ts.
          onSubmit={onSubmit}
          className="space-y-2"
          aria-label={isEmail ? m["compose.email"] : isSms ? m["compose.sms"] : m["compose.note"]}
        >
          <input type="hidden" name="contactId" value={contactId} />
          {isEmail ? (
            <Input name="subject" placeholder={m["compose.subject"]} className="text-sm" />
          ) : null}
          <div className="flex gap-2">
            <Input
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                isEmail ? m["compose.emailPlaceholder"]
                  : isSms ? m["compose.smsPlaceholder"]
                    : m["contact.addNote"]
              }
              className="flex-1"
              required
            />
            {/* Disables while pending. The note form this replaced had that
                protection via SubmitButton; sending is the slowest action in
                the app and the only one that texts or mails a real person, so
                a double-click here costs a duplicate send. */}
            <EmailSendButton
              label={isEmail || isSms ? m["compose.send"] : m["common.add"]}
              pendingLabel={isEmail || isSms ? m["compose.sending"] : m["common.saving"]}
              variant={isEmail || isSms ? "default" : "outline"}
              pending={pending}
            />
          </div>
          {isSms ? (
            <p className="text-xs text-muted-foreground">
              {m["compose.smsSegments"]
                .replace("{chars}", String(segmentsFor(body).chars))
                .replace("{segments}", String(segmentsFor(body).segments))}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
