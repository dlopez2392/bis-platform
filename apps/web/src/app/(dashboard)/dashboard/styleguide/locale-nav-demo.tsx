"use client";

import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";

/**
 * One nav label, read through the SAME useLocale()/t() path app-sidebar.tsx
 * itself uses (Task 6, Spanish-runtime lane) — a render-level proof that the
 * LocaleProvider → useLocale() → t() plumbing actually swaps the string,
 * not a literal `t(m, key, "es")` call that would pass even if the
 * Provider/hook pair were wired wrong.
 *
 * `data-nav-label` is Task 11's own hook (its brief, Step 2): the
 * pseudo-locale overflow check locates every rendered nav label by this
 * attribute, on THIS page rather than the live dashboard route — see the
 * Task 6 brief's "Note on scope" for why `?locale=pseudo` cannot reach the
 * account layout's own `requestLocale` call (a `layout.tsx` never receives
 * `searchParams`), while `/styleguide` (a `page.tsx`) does.
 */
function NavLabelDemo({ labelKey }: { labelKey: MessageKey }) {
  const locale = useLocale();
  return (
    <span data-nav-label data-locale={locale} className="text-sm font-medium">
      {t(m, labelKey, locale)}
    </span>
  );
}

/**
 * Side-by-side columns for one real nav label, one per locale — a
 * flex-wrap row, not a fixed two-column grid, so Task 11's own
 * `?locale=pseudo` third column has somewhere to land without a layout
 * change (Task 6 brief, Step 5).
 */
export function LocaleNavDemo({ labelKey }: { labelKey: MessageKey }) {
  return (
    <div className="flex w-full flex-wrap gap-4">
      {(["en", "es"] as const).map((locale) => (
        <div key={locale} className="flex flex-col gap-1">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {locale}
          </span>
          <LocaleProvider locale={locale}>
            <NavLabelDemo labelKey={labelKey} />
          </LocaleProvider>
        </div>
      ))}
    </div>
  );
}
