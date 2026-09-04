"use client";

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { m } from "@/lib/messages";
import { isSendRejected } from "./send-errors";
import { EmailSendButton } from "./send-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";

// The Conversations thread has no note concept — every message here is an
// outbound email — so this is a plain email form rather than the note/email
// toggle in contacts/[contactId]/message-composer.tsx. Reusing that component
// as-is would leave a mode switch on screen with nothing for it to switch to.
export function EmailComposer({
  contactId,
  action,
}: {
  contactId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const { pending, onSubmit } = useFormSubmit(async (formData, form) => {
    try {
      await action(formData);
      toast.success(m["compose.sent"]);
      // Clear for the next message — what React's reset used to do, now
      // explicit and ONLY on success. On failure the draft must survive: a
      // rejected send used to wipe the subject and body the operator had just
      // written, which is the worst possible moment to lose them.
      if (form.isConnected) form.reset();
    } catch (e) {
      toast.error(isSendRejected(e) ? m["compose.sendRejected"] : m["compose.sendFailed"]);
    }
  });

  return (
    <form
      // onSubmit, NOT the `action` prop — see lib/forms/use-form-submit.ts.
      onSubmit={onSubmit}
      className="space-y-2"
      aria-label={m["compose.email"]}
    >
      <input type="hidden" name="contactId" value={contactId} />
      <Input name="subject" placeholder={m["compose.subject"]} className="text-sm" />
      <div className="flex gap-2">
        <Input
          name="body"
          placeholder={m["compose.emailPlaceholder"]}
          className="flex-1"
          required
        />
        <EmailSendButton pending={pending} />
      </div>
    </form>
  );
}
