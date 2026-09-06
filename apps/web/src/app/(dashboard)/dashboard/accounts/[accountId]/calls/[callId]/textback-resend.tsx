"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { isSendRejected, sendRejectedReason } from "../../conversations/send-errors";

/**
 * "Send it now" — the call detail page's one interactive answer to a
 * text-back that never went out. THE DETAIL PAGE ONLY: the list row is a
 * whole-row click target, and a nested button there would double-fire the
 * row's navigation and confuse the tab order (see calls-table.tsx's own note
 * beside the chevron cell). The list gets the badge and nothing else.
 *
 * `sendSmsAction`, bound to the account by the server component above —
 * never a second send path. Which means every gate that action enforces (A2P
 * approval, a live number, a phone that survives toE164) applies here
 * unchanged, and this component re-derives none of them.
 *
 * The body is the one that FAILED, carried through as a hidden field: an
 * operator who is already being told the platform dropped their message
 * should not also be made to retype it.
 *
 * `onSubmit` via useFormSubmit, never the `action` prop — see
 * lib/forms/use-form-submit.ts.
 */
export function TextbackResend({
  contactId,
  body,
  action,
}: {
  contactId: string;
  /** The exact body of the failed message, resent verbatim. */
  body: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    try {
      await action(formData);
      toast.success(m["compose.smsSent"]);
      // `sendSmsAction` revalidates the conversation and contact pages, not
      // this one — it has no idea it was called from a call. Without this
      // refresh the badge above would still be sitting there after a send
      // that worked, and the next click would text a real phone twice.
      router.refresh();
    } catch (e) {
      // A thrown server action that nothing catches reaches the operator as a
      // digest-redacted error boundary. `rejectSend` reasons are already
      // curated plain-language copy, so they are shown verbatim; anything
      // else is a provider failure and gets the generic line.
      toast.error(
        isSendRejected(e)
          ? (sendRejectedReason(e) ?? m["compose.smsSendRejected"])
          : m["compose.smsFailed"],
      );
    }
  });

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="body" value={body} />
      {/* Disabled while in flight. Sending is the one action on this page
          that reaches a real phone, so a double-click costs a duplicate
          text — `useFormSubmit` holds its own ref guard behind this. */}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? m["compose.sending"] : m["calls.textbackResend"]}
      </Button>
    </form>
  );
}
