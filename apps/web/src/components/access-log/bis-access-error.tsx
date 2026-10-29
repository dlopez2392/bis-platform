"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * F-118 part 1 (spec 6.3): the section's own error state (rule 5 extended to the card — a failed read
 * here never costs the Team card above it). Ghost "Try again" re-reads the server page, the house
 * pattern (`components/record/record-card.tsx`'s `RecordCardRetry`).
 */
export function BisAccessError() {
  const locale = useLocale();
  const router = useRouter();
  return (
    <div role="alert" className="space-y-2 text-sm">
      <p className="text-[var(--text-2)]">{t(m, "accessLog.error", locale)}</p>
      <Button type="button" variant="ghost" size="sm" onClick={() => router.refresh()}>
        {t(m, "accessLog.retry", locale)}
      </Button>
    </div>
  );
}
