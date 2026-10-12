import type { TimelineSource } from "@bis/db";
import { encodeCursor } from "@/lib/cursor";

/** The timeline card's own anchor, so Older and Newer land on the rows, not the page top. */
export const TIMELINE_ANCHOR = "record-timeline";
// The QA override (request-locale.ts); anything else on the URL is dropped, never echoed.
const QA_LOCALES = new Set(["en", "es", "pseudo"]);

/**
 * One pager (DESIGN.md, Paged lists; spec C3): "Older" carries `?before=` (the merge's own cursor),
 * "Newer" returns to the head (contacts/page.tsx's buildNewerHref idiom). Built with URLSearchParams.
 *
 * `failed` is the page's own `TimelinePage.failed`. listContactTimelinePage computes `older` from the
 * sources that LOADED, so on a page where one failed, following Older would skip that source's rows
 * between the two cursors (and `older: null` would not mean the history ended). Such a page offers
 * no Older; its failure notice's "Try again" re-reads the same `?before=`. Newer stays.
 */
export function timelinePagerHrefs(p: {
  basePath: string; older: { v: string; id: string } | null; paged: boolean; failed: readonly TimelineSource[]; locale?: unknown;
}): { olderHref: string | null; newerHref: string | null } {
  const keep: Record<string, string> = typeof p.locale === "string" && QA_LOCALES.has(p.locale) ? { locale: p.locale } : {};
  const href = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...keep, ...extra }).toString();
    return `${p.basePath}${qs ? `?${qs}` : ""}#${TIMELINE_ANCHOR}`;
  };
  return {
    olderHref: p.older && p.failed.length === 0 ? href({ before: encodeCursor(p.older) }) : null,
    newerHref: p.paged ? href({}) : null,
  };
}
