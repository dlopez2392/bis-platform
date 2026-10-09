import type { ReactNode } from "react";
import { isBookingToken } from "@/lib/booking/links";
import { BrandedDeadEnd } from "../../../branded-dead-end";
import { loadCalendarSafe, loadCalendarBranding } from "../../data";
import { loadMoveContextSafe } from "./data";

/**
 * The move page's own segment layout, there to brand its dead end (D-109),
 * exactly as the cancel page's does: a link whose token names no booking of
 * the calendar in its URL (truncated by a mail client, mistyped) under a REAL
 * calendar's id is that business's dead end; an id that never existed, or
 * any read failure, stays neutral.
 *
 * A working link passes straight through: the page draws its own brand
 * header, and the token read here is the page's own `cache()`d one. A
 * malformed token is never looked up (the page 404s it unread too).
 */
export default async function MoveSegmentLayout({
  params, children,
}: {
  params: Promise<{ publicId: string; token: string }>;
  children: ReactNode;
}) {
  const { publicId, token } = await params;
  if (isBookingToken(token)) {
    const ctx = await loadMoveContextSafe(token);
    if (ctx && ctx.calendar.public_id === publicId) return children;
  }
  const calendar = await loadCalendarSafe(publicId);
  if (!calendar) return children;
  const branding = await loadCalendarBranding(calendar.account_id, publicId);
  if (!branding) return children;
  return <BrandedDeadEnd branding={branding}>{children}</BrandedDeadEnd>;
}
