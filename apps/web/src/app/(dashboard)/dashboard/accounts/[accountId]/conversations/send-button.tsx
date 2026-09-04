"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

// useFormStatus only reports the parent <form>'s pending state when the
// component calling it is itself a child of that <form> — inline in the
// component that renders the <form> it always reports pending: false. This
// is that child, shared by both email composers (contact timeline and
// Conversations) so the send button disables and the Resend round-trip
// can't be double-submitted from either surface.
export function EmailSendButton({
  label = m["compose.send"],
  pendingLabel = m["compose.sending"],
  variant = "default",
  pending: pendingProp,
}: {
  label?: string;
  pendingLabel?: string;
  variant?: "default" | "outline";
  /** Supply this for a form driven by `useFormSubmit` (onSubmit) rather than
   *  the `action` prop — `useFormStatus` reports nothing for those, so without
   *  it the send button would never disable and the Resend round-trip could be
   *  double-submitted, which is the exact thing this component exists for. */
  pending?: boolean;
} = {}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
