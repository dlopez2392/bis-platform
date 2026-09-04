"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { isSendRejected } from "../../conversations/send-errors";
import { EmailSendButton } from "../../conversations/send-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";

type Mode = "note" | "email";

export function MessageComposer({
  contactId,
  contactHasEmail,
  noteAction,
  emailAction,
}: {
  contactId: string;
  contactHasEmail: boolean;
  noteAction: (formData: FormData) => Promise<void>;
  emailAction: (formData: FormData) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("note");
  const isEmail = mode === "email";

  const { pending, onSubmit } = useFormSubmit(async (formData, form) => {
    try {
      await (isEmail ? emailAction : noteAction)(formData);
      if (isEmail) toast.success(m["compose.sent"]);
      // Clear for the next message — what React's reset used to do, now
      // explicit and ONLY on success. On failure the draft must survive: a
      // rejected send used to wipe the note or email the operator had just
      // typed, at the worst possible moment to lose it.
      if (form.isConnected) form.reset();
    } catch (e) {
      if (!isEmail) {
        toast.error(m["compose.noteFailed"]);
      } else {
        toast.error(isSendRejected(e) ? m["compose.sendRejected"] : m["compose.sendFailed"]);
      }
    }
  });

  return (
    <div className="w-full space-y-2">
      <div className="flex gap-1">
        {(["note", "email"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              mode === value
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "note" ? m["compose.note"] : m["compose.email"]}
          </button>
        ))}
      </div>

      {isEmail && !contactHasEmail ? (
        <p className="text-xs text-muted-foreground">{m["compose.noEmailOnContact"]}</p>
      ) : (
        <form
          key={mode}
          // onSubmit, NOT the `action` prop — see lib/forms/use-form-submit.ts.
          onSubmit={onSubmit}
          className="space-y-2"
          aria-label={isEmail ? m["compose.email"] : m["compose.note"]}
        >
          <input type="hidden" name="contactId" value={contactId} />
          {isEmail ? (
            <Input name="subject" placeholder={m["compose.subject"]} className="text-sm" />
          ) : null}
          <div className="flex gap-2">
            <Input
              name="body"
              placeholder={isEmail ? m["compose.emailPlaceholder"] : m["contact.addNote"]}
              className="flex-1"
              required
            />
            {/* Disables while pending. The note form this replaced had that
                protection via SubmitButton; sending is the slowest action in
                the app and the only one that mails a real person, so a
                double-click here costs a duplicate email. */}
            <EmailSendButton
              label={isEmail ? m["compose.send"] : m["common.add"]}
              pendingLabel={isEmail ? m["compose.sending"] : m["common.saving"]}
              variant={isEmail ? "default" : "outline"}
              pending={pending}
            />
          </div>
        </form>
      )}
    </div>
  );
}
