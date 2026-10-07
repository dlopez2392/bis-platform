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
 * There used to ALSO be a non-root `app/b/[publicId]/layout.tsx` sharing
 * this module, branding/theming a known-but-not-live calendar's not-found
 * page the way `/f` and `/c` do (F-102 review round, fix 6) — REMOVED
 * (owner decision, second review round): a reviewer proved it two ways on
 * a built app. (a) It never actually worked: `notFound()` is caught by
 * `app/b/not-found.tsx`, which sits ABOVE this segment in the tree and
 * REPLACES it entirely — a disabled calendar's 404 showed the tab title
 * "Book with Test Client One" (the layout's OWN `generateMetadata` DID
 * run) but no brand chrome at all (the layout COMPONENT never got a chance
 * to wrap anything, headless-browser-checked). (b) Even fixed, it would
 * cost a real DB query on every cancel request (this layout nests under
 * `cancel/[token]/page.tsx` too), and would wrap a WORKING cancel page in
 * a second brand header whenever the calendar happened to be disabled
 * with bookings still live on it. `/b`'s not-found stays NEUTRAL — see
 * `app/b/not-found.tsx`'s own comment. Branded `/b` dead ends are a
 * separate, tracked defect, not solved by resurrecting that file.
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
