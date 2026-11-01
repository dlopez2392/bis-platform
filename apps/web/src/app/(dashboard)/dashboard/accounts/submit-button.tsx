"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

export function SubmitButton({
  children, pending: pendingProp, disabled, locale = "en", className,
}: {
  children: React.ReactNode;
  /** Supply this for a form driven by `useFormSubmit` (onSubmit) rather than
   *  the `action` prop. `useFormStatus` only reports for action-prop forms, so
   *  without it such a button would never disable and could be double-clicked
   *  into a second write. Omit it for action-prop forms, which keep working
   *  exactly as before. */
  pending?: boolean;
  /** Force the button disabled regardless of submit status — for a form whose
   *  own read failed and must not be actionable until reloaded (Part C fix
   *  wave item 3: a degraded quiet-hours read must not look editable). Omit
   *  it and behavior is unchanged. */
  disabled?: boolean;
  /** S-10 T6: optional, defaulting to "en" so every pre-existing caller
   *  (34 files, mostly agency-only) is unaffected; the client Branding
   *  panel passes its own resolved locale. */
  locale?: Locale;
  /** S-10 T9a: merged onto the Button (which merges it via its own `cn()`)
   *  — e.g. "h-auto whitespace-normal" for a form whose label may wrap
   *  under long or pseudo-padded copy (closed-days-card.tsx's "Agregar
   *  días cerrados" clipped the viewport by 6px without it). Optional;
   *  every existing caller passes none and renders exactly as before. */
  className?: string;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending || Boolean(disabled)} className={className}>
      {pending ? t(m, "common.saving", locale) : children}
    </Button>
  );
}
