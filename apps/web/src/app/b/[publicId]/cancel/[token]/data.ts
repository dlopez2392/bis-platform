import { cache } from "react";
import { serviceDb } from "@bis/db";
import { lookupBookingByToken } from "./actions";

/**
 * Shared by `page.tsx` (component and `generateMetadata`) and `layout.tsx`:
 * one function reference, so React's `cache()` dedupes the token lookup to
 * ONE query per request across all three. The layout asking for the same row
 * is what lets it brand a dead end at no cost to a working link (D-109).
 */
export const loadBooking = cache((token: string) => lookupBookingByToken(serviceDb(), token));

/**
 * For the callers with no `error.tsx` to land in: `generateMetadata`, and the
 * layout, which sits ABOVE nothing that could catch it. Only the page
 * component's own `loadBooking` is allowed to throw (it reaches
 * `app/b/error.tsx`).
 */
export async function loadBookingSafe(token: string): ReturnType<typeof loadBooking> {
  try {
    return await loadBooking(token);
  } catch (e) {
    console.error(`cancel/${token}: booking read failed: ${String(e)}`);
    return null;
  }
}
