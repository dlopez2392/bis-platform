"use client";

import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { deadEndTextStyle } from "@/components/public/dead-end-style";

/**
 * Replaces the framework's own English not-found box for a disabled or
 * unknown calendar, AND for a stale/unknown cancel link — both
 * `app/b/[publicId]/page.tsx` and `.../cancel/[token]/page.tsx` call
 * `notFound()` under this one tree, and (unlike `/f` and `/c`) there is no
 * `[publicId]`-level ROOT layout here to colocate a narrower one against: a
 * calendar carries no per-document locale default (see `app/b/layout.tsx`'s
 * own comment), so moving `<html>` down would gain `lang` nothing. There
 * IS now a non-root `app/b/[publicId]/layout.tsx` (F-102 review round, fix
 * 6) that brands and themes THIS component when the calendar's account is
 * known but not live, mirroring `/f` and `/c` — this component itself still
 * has no props and does not attempt that branding on its own.
 *
 * Same reasoning as `app/f/[publicId]/not-found.tsx` for being a Client
 * Component with zero props reading `?locale=` via `useSearchParams`; no
 * `usePublicLocaleDefault()` here (unlike `/f`/`/c`) because there genuinely
 * is no per-document default for this tree to thread down — "en" is the
 * same fallback `page.tsx` has always used for an absent `?locale=`.
 *
 * Colour routes through `deadEndTextStyle` (F-102 review round, fix 5) —
 * `var(--foreground, …)` so the brand/theme wrapper above picks up the
 * real colour when present, and `?theme=dark` picks a readable literal when
 * it is not (this file used to hard-code the light literal always, invisible
 * on a dark embed's transparent body).
 */
export default function PublicBookingNotFound() {
  const params = useSearchParams();
  const locale = normalizeLocale(params.get("locale") ?? undefined, "en");
  const strings = bookingStrings(locale);

  return (
    <div lang={locale} style={deadEndTextStyle(params.get("theme"))}>
      <p role="alert" style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
        {strings.notFoundTitle}
      </p>
      <p style={{ fontSize: 15, margin: 0 }}>{strings.notFoundBody}</p>
    </div>
  );
}
