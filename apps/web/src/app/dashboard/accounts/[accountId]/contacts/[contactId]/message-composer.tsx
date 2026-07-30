"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { isSendRejected } from "../../conversations/send-errors";
import { EmailSendButton } from "../../conversations/send-button";

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
          action={async (formData) => {
            try {
              await (isEmail ? emailAction : noteAction)(formData);
              if (isEmail) toast.success(m["compose.sent"]);
            } catch (e) {
              if (!isEmail) {
                toast.error(m["compose.noteFailed"]);
              } else {
                toast.error(isSendRejected(e) ? m["compose.sendRejected"] : m["compose.sendFailed"]);
              }
            }
          }}
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
            />
          </div>
        </form>
      )}
    </div>
  );
}
