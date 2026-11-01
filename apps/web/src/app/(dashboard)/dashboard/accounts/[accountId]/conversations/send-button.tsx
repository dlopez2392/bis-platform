"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";

// useFormStatus only reports the parent <form>'s pending state when the
// component calling it is itself a child of that <form> — inline in the
// component that renders the <form> it always reports pending: false. This
// is that child, shared by both email composers (contact timeline and
// Conversations) so the send button disables and the Resend round-trip
// can't be double-submitted from either surface.
export function EmailSendButton({
  label,
  pendingLabel,
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
  // A caller may omit label/pendingLabel entirely and take the default (the
  // message composer's own caller always passes both explicitly today, but
  // the doc comment above promises this component to Conversations too, and
  // nothing stops a future caller from relying on the default) — so the
  // default itself must ask for the reader's own locale, never pin English.
  const locale = useLocale();
  const resolvedLabel = label ?? t(m, "compose.send", locale);
  const resolvedPendingLabel = pendingLabel ?? t(m, "compose.sending", locale);
  return (
    <Button type="submit" variant={variant} disabled={pending} className="min-h-11 md:min-h-8">
      {pending ? resolvedPendingLabel : resolvedLabel}
    </Button>
  );
}
