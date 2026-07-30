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
}: {
  label?: string;
  pendingLabel?: string;
  variant?: "default" | "outline";
} = {}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
