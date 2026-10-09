import { cache } from "react";
import { serviceDb, getCalendarByPublicId, getBranding, type CalendarRow, type Branding } from "@bis/db";

/**
 * Shared by `generateMetadata` and the page component below in `page.tsx`
 * (both need this exact row against the SAME request) — React's `cache()`
 * dedupes this to ONE query per request as long as both call the SAME
 * function reference with the same `publicId`. Mirrors
 * `app/f/[publicId]/data.ts`'s split — including that file's note that
 * this is ONE query for a LIVE render only; a 404 costs two, because Next
 * re-renders the not-found tree in a second pass `cache()` does not share
 * with the first (accepted, F-102 review round, item 10).
 *
 * `(book)/layout.tsx` and `cancel/[token]/layout.tsx` share it too, to
 * brand a dead end (D-109). On the booking page that is the same cached read
 * the page makes anyway; the cancel layout reaches it only on a dead end.
 * #185's `app/b/[publicId]/layout.tsx` (deleted) branded nothing, because it
 * had no `not-found.tsx` beside it, and it cost a query on every cancel
 * request because it sat over `cancel/`; see `(book)/layout.tsx` for how
 * the route group avoids both.
 *
 * `getCalendarByPublicId` already returns a disabled calendar (unlike
 * `getPublishedFormByPublicId`, it never filtered on `enabled` — `page.tsx`
 * has always applied that check itself), so there is no `getFormByPublicId`-
 * style "any status" sibling needed here.
 */
export const loadCalendar = cache(
  (publicId: string) => getCalendarByPublicId(serviceDb(), publicId),
);

/**
 * Every `generateMetadata` on this route goes through THIS, not
 * `loadCalendar` directly (F-102 review round, fix 1 — see
 * `app/f/[publicId]/data.ts`'s identical `loadFormSafe` for the full
 * reasoning, confirmed by a live build+curl check). Only a PAGE
 * COMPONENT's own call (via the real `loadCalendar`) is allowed to throw —
 * that one lands in `app/b/error.tsx`.
 */
export async function loadCalendarSafe(publicId: string): Promise<CalendarRow | null> {
  try {
    return await loadCalendar(publicId);
  } catch (e) {
    console.error(`/b/${publicId}: calendar read failed: ${String(e)}`);
    return null;
  }
}

/** The predicate `page.tsx`'s own `if (!calendar || !calendar.enabled)`
 *  used to spell out inline, now named so its `notFound()` guard and its
 *  `generateMetadata` apply the IDENTICAL check against the same cached
 *  row. */
export function isCalendarLive(calendar: Pick<CalendarRow, "enabled">): boolean {
  return calendar.enabled;
}

/** Shared `cache()`'d branding reader — same split and the same null-on-
 *  failure reasoning as `app/f/[publicId]/data.ts`'s `loadFormBranding`. */
export const loadCalendarBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`public booking ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

export const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
