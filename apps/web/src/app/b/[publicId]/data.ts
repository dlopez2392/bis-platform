import { cache } from "react";
import {
  serviceDb, getCalendarByPublicId, getBranding, getBusinessStatusRow, listClosedDaysFrom, readHoursChain,
  type CalendarRow, type Branding,
} from "@bis/db";
import { effectiveStatus, hoursChain, dayKey, addDays } from "@/lib/business-status/status";
import { bookingStrings, intlLocale } from "@/lib/booking/public-strings";
import type { PublicLocale } from "@/lib/forms/public-strings";

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

export type ClosureView = { notice: string | null; closedDayKeys: string[] };

/** Every date key of `r` that falls inside `[fromKey, toKey]` (both inclusive), clipped at each end --
 *  the picker's own horizon is `[todayKey, todayKey + maxAdvanceDays]`, the WHOLE last calendar day. */
function keysWithin(r: { starts_on: string; ends_on: string }, fromKey: string, toKey: string): string[] {
  const start = r.starts_on < fromKey ? fromKey : r.starts_on;
  const end = r.ends_on > toKey ? toKey : r.ends_on;
  const out: string[] = [];
  for (let k = start, i = 0; k <= end && i <= 400; k = addDays(k, 1), i++) out.push(k);
  return out;
}

/**
 * S-47d (spec section 5.3): what this page says above the picker when the one switch or a planned
 * closed day puts the business out of hours TODAY -- and which days inside the picker's own horizon
 * (`[todayKey, todayKey + maxAdvanceDays]`) are closed outright, so `SlotPicker`'s empty state can say
 * so without a round trip to the slot engine.
 *
 * A failed read fails CLOSED the other way from a notice's purpose: the slot engine already blocks the
 * closed times on its own and fails closed on its own read failure (Task 5), so a notice that cannot be
 * read is cosmetic only -- this returns no notice and no closed-day keys rather than throwing the page.
 */
export async function loadClosureView(
  accountId: string, timezone: string, now: Date, maxAdvanceDays: number, locale: PublicLocale,
): Promise<ClosureView> {
  const db = serviceDb();
  const todayKey = dayKey(now, timezone);
  try {
    const [row, closedDays, hoursRaw] = await Promise.all([
      getBusinessStatusRow(db, accountId),
      listClosedDaysFrom(db, accountId, todayKey),
      readHoursChain(db, accountId),
    ]);
    const hours = hoursChain(hoursRaw.businessHours, hoursRaw.calendarHours);
    const status = effectiveStatus({ row, closedDays, hours, timezone, now });
    const strings = bookingStrings(locale);
    let notice: string | null = null;
    if (status.state === "closed_today" || status.state === "closed_day") {
      notice = strings.closedTodayNotice;
    } else if (status.state === "storm") {
      if (status.reopensAt === null) {
        notice = strings.stormNotice;
      } else {
        const date = new Intl.DateTimeFormat(intlLocale(locale), {
          weekday: "long", month: "long", day: "numeric", timeZone: timezone,
        }).format(status.reopensAt);
        notice = strings.stormUntilNotice.replace("{date}", date);
      }
    }
    const horizonKey = addDays(todayKey, maxAdvanceDays);
    const closedDayKeys = [...new Set(closedDays.flatMap((r) => keysWithin(r, todayKey, horizonKey)))].sort();
    return { notice, closedDayKeys };
  } catch {
    console.error(`public booking ${accountId}: closure read failed`);
    return { notice: null, closedDayKeys: [] };
  }
}

export const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
