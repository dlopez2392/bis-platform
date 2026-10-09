import type { ReactNode } from "react";
import { BrandedDeadEnd } from "../../branded-dead-end";
import { loadCalendarSafe, isCalendarLive, loadCalendarBranding } from "../data";

/**
 * The booking page's own segment layout, there to brand its dead end (D-109).
 *
 * WHY A ROUTE GROUP. `page.tsx` calls `notFound()` for a switched-off
 * calendar, and Next renders the nearest `not-found.tsx` at or above that
 * page's segment INSIDE that segment's layout. #185's
 * `app/b/[publicId]/layout.tsx` had no `not-found.tsx` beside it, so the throw
 * went past it to `app/b/not-found.tsx`, above it, and the brand never drew;
 * it also sat over `cancel/[token]`, costing a query on every cancel and
 * doubling a working cancel page's header. `(book)` holds the booking page
 * alone: this layout and `./not-found.tsx` sit in the page's own segment, and
 * the cancel route is a sibling, never under it (`app/b/dead-ends.test.ts`
 * pins both facts from the tree).
 *
 * NO QUERY ON THE HAPPY PATH. `loadCalendarSafe` is the same `cache()`d read
 * the page and its `generateMetadata` already make, so React dedupes it to
 * the one query the page always cost; branding is read only for a real
 * calendar that is not live, and a live one passes straight through.
 *
 * A switched-off calendar is branded; an id that never existed, or any read
 * failure, stays neutral (`/f` and `/c` draw the same split; a read failure
 * on the page itself still reaches `app/b/error.tsx`).
 */
export default async function BookingSegmentLayout({
  params, children,
}: {
  params: Promise<{ publicId: string }>;
  children: ReactNode;
}) {
  const { publicId } = await params;
  const calendar = await loadCalendarSafe(publicId);
  if (!calendar || isCalendarLive(calendar)) return children;
  const branding = await loadCalendarBranding(calendar.account_id, publicId);
  if (!branding) return children;
  return <BrandedDeadEnd branding={branding}>{children}</BrandedDeadEnd>;
}
