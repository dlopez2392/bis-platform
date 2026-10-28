"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Toasts (components/ui/sonner.tsx): the app's one Toaster draws them from
 * tokens with Sonner's own styling off (sonner-style.test.ts). Each button is
 * a real line from the catalogue and raises it as the kind the app raises it
 * — an Undo toast (rule 6), a failure, a warning — in English and in Spanish,
 * so both themes and both languages can be checked by eye and by computed
 * value. The kinds differ by their icon's shape and their words, never by
 * colour alone (rule 3). Nothing here writes anything.
 */
function Row({ locale }: { locale: Locale }) {
  const done = t(m, "work.done.toast", locale);
  const failed = t(m, "calendar.bookings.statusUpdateFailed", locale);
  const zone = t(m, "zone.guessed.agency", locale);
  return (
    <div lang={locale} className="flex flex-wrap gap-2">
      <Button type="button" variant="ghost" size="sm"
        onClick={() => toast.success(done, { action: { label: t(m, "common.undo", locale), onClick: () => {} } })}>
        {done}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => toast.error(failed)}>
        {failed}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => toast.warning(zone)}>
        {zone}
      </Button>
    </div>
  );
}

export function ToastDemo() {
  return (
    <div className="flex flex-col gap-2" data-slot="toast-demo">
      <Row locale="en" />
      <Row locale="es" />
    </div>
  );
}
