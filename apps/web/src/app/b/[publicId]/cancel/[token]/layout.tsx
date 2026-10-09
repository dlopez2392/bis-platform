import type { ReactNode } from "react";
import { BrandedDeadEnd } from "../../../branded-dead-end";
import { loadCalendarSafe, loadCalendarBranding } from "../../data";
import { loadBookingSafe } from "./data";

/**
 * The cancel page's own segment layout, there to brand its dead end (D-109):
 * a token that matches nothing (a link truncated by a mail client, or
 * mistyped) under a REAL calendar's id. Sits beside `./not-found.tsx` for the
 * reason `(book)/layout.tsx` gives.
 *
 * A working link passes straight through: the page draws its own brand
 * header, and the token lookup here is the page's own `cache()`d read
 * (`./data.ts`), so it costs no extra query. Only a dead end reads the
 * calendar and its branding. An id that never existed, or any read failure,
 * stays neutral.
 */
export default async function CancelSegmentLayout({
  params, children,
}: {
  params: Promise<{ publicId: string; token: string }>;
  children: ReactNode;
}) {
  const { publicId, token } = await params;
  if (await loadBookingSafe(token)) return children;
  const calendar = await loadCalendarSafe(publicId);
  if (!calendar) return children;
  const branding = await loadCalendarBranding(calendar.account_id, publicId);
  if (!branding) return children;
  return <BrandedDeadEnd branding={branding}>{children}</BrandedDeadEnd>;
}
