"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * F-118 part 1 (spec 6.1, 6.3): the "BIS access" section's chrome on the Team page — the title, the
 * intro and the three disclosure notes, in order (automatic work, the in-account lists that are part of
 * a visit, and the agency's own cross-account lists, ruling 3 and review I5), then whatever the caller
 * renders (the loaded/empty/error state). `children` carries the state so the frame itself never throws.
 */
export function BisAccessFrame({ children }: { children?: ReactNode }) {
  const locale = useLocale();
  return (
    <section id="bis-access" lang={locale} aria-labelledby="bis-access-title" className="mt-8 space-y-3">
      <h2 id="bis-access-title" className="text-base font-semibold">{t(m, "accessLog.title", locale)}</h2>
      <p className="text-sm text-[var(--text-2)]">{t(m, "accessLog.intro", locale)}</p>
      <p className="text-xs text-[var(--text-3)]">{t(m, "accessLog.note.automatic", locale)}</p>
      <p className="text-xs text-[var(--text-3)]">{t(m, "accessLog.note.lists", locale)}</p>
      <p className="text-xs text-[var(--text-3)]">{t(m, "accessLog.note.agencyLists", locale)}</p>
      {children}
    </section>
  );
}
