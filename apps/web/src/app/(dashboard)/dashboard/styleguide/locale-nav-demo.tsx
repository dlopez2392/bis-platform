"use client";

import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_EXPANDED_WIDTH_CLASS, NAV_ROW_GAP_CLASS, NAV_ROW_EXPANDED_PADDING_CLASS,
  NAV_ICON_SIZE_CLASS, NAV_LABEL_TRUNCATE_CLASS,
} from "@/components/app-sidebar";

/**
 * The real sidebar row's geometry (Task 11, fix round 1 — reviewer C1): the
 * ORIGINAL version of this demo rendered the label in a bare `<span
 * className="text-sm font-medium">` with no width constraint and no
 * truncate class, so `scrollWidth === clientWidth` by construction and
 * e2e/i18n-overflow.spec.ts's check could never fail. Every class below is
 * IMPORTED from app-sidebar.tsx itself — the aside's real expanded width,
 * the Link row's real icon size/gap/padding — rather than a second,
 * hand-copied set of the same literals that could silently drift from the
 * real sidebar's own measurements. `app-sidebar-nav-geometry.test.ts`
 * source-scans app-sidebar.tsx and asserts each constant is still a
 * literal substring of its real render (the constants are declared there,
 * not wired back into the render itself — see that file's own comment on
 * why), so an edit to one side without the other is caught.
 *
 * The aside's own `px-3` (and the nav's `-mx-3 ... px-3`, which nets to
 * that same inset — see app-sidebar.tsx's own comment on the `<nav>`) is
 * reproduced here as a literal `px-3` rather than a sixth import:
 * app-sidebar-nav-geometry.test.ts source-scans app-sidebar.tsx to confirm
 * both still say exactly that, so a change there is caught too.
 */
export function NavRowGeometry({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(SIDEBAR_EXPANDED_WIDTH_CLASS, "px-3")}>
      <div className={cn("flex items-center", NAV_ROW_GAP_CLASS, NAV_ROW_EXPANDED_PADDING_CLASS)}>
        <span className={cn(NAV_ICON_SIZE_CLASS, "shrink-0 rounded-sm bg-muted-foreground/20")} aria-hidden />
        {children}
      </div>
    </div>
  );
}

/**
 * The label span's own real class (the bounded flex-1 box + `truncate`),
 * same import as `NavRowGeometry` above — composed with this demo's own
 * `text-sm font-medium` type size. The real sidebar uses `text-[13.5px]`;
 * only the WIDTH-relevant classes (`min-w-0 flex-1 truncate`) are what this
 * check cares about, and those are identical either way.
 */
export const NAV_LABEL_SPAN_CLASS = cn("text-sm font-medium", NAV_LABEL_TRUNCATE_CLASS);

/**
 * One nav label, read through the SAME useLocale()/t() path app-sidebar.tsx
 * itself uses (Task 6, Spanish-runtime lane) — a render-level proof that the
 * LocaleProvider → useLocale() → t() plumbing actually swaps the string,
 * not a literal `t(m, key, "es")` call that would pass even if the
 * Provider/hook pair were wired wrong.
 *
 * `data-nav-label` (a boolean JSX attribute here, which React renders as
 * the literal string `data-nav-label="true"` — verified via
 * `renderToStaticMarkup`) is Task 11's own hook: the pseudo-locale overflow
 * check locates every rendered REAL-locale nav label by
 * `[data-nav-label='true']`, on THIS page rather than the live dashboard
 * route — see the Task 6 brief's "Note on scope" for why `?locale=pseudo`
 * cannot reach the account layout's own `requestLocale` call (a
 * `layout.tsx` never receives `searchParams`), while `/styleguide` (a
 * `page.tsx`) does. `title` mirrors the real sidebar Link's own
 * unconditional `title={item.label}` (app-sidebar.tsx), carrying the full,
 * un-truncated text.
 */
function NavLabelDemo({ labelKey }: { labelKey: MessageKey }) {
  const locale = useLocale();
  const label = t(m, labelKey, locale);
  return (
    <NavRowGeometry>
      <span data-nav-label data-locale={locale} title={label} className={NAV_LABEL_SPAN_CLASS}>
        {label}
      </span>
    </NavRowGeometry>
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
