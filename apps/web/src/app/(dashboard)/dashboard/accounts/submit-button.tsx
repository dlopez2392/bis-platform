"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

export function SubmitButton({
  children, pending: pendingProp,
}: {
  children: React.ReactNode;
  /** Supply this for a form driven by `useFormSubmit` (onSubmit) rather than
   *  the `action` prop. `useFormStatus` only reports for action-prop forms, so
   *  without it such a button would never disable and could be double-clicked
   *  into a second write. Omit it for action-prop forms, which keep working
   *  exactly as before. */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : children}
    </Button>
  );
}
