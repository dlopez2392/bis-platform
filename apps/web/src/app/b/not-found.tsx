"use client";

import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { deadEndTextStyle } from "@/components/public/dead-end-style";

/**
 * Replaces the framework's own English not-found box on every `/b` dead
 * end: a switched-off or unknown calendar, and a cancel link whose token
 * matches nothing. Localized (via `?locale=`) and token-routed (via
 * `deadEndTextStyle`, honoring `?theme=`).
 *
 * D-109: the booking page and the cancel page each re-export this from a
 * `not-found.tsx` in their OWN segment (`[publicId]/(book)/` and
 * `cancel/[token]/`), beside a layout that wraps it in the business's
 * brand when the link names a real calendar (`app/b/branded-dead-end.tsx`).
 * Rendered from HERE, at the top of the tree, it is neutral: that is the
 * unknown-id case, and any `/b` path no deeper segment claims. #185's
 * attempt failed because its layout had no not-found beside it, so the
 * throw came straight here, above the layout; `app/b/dead-ends.test.ts`
 * pins the tree so that cannot recur.
 *
 * Same reasoning as `app/f/[publicId]/not-found.tsx` for being a Client
 * Component with zero props reading `?locale=` via `useSearchParams`; no
 * `usePublicLocaleDefault()` here (unlike `/f`/`/c`) because there genuinely
 * is no per-document default for this tree to thread down — "en" is the
 * same fallback `page.tsx` has always used for an absent `?locale=`.
 *
 * Colour routes through `deadEndTextStyle` (F-102 review round, fix 5) —
 * `var(--foreground, …)`, with `?theme=dark` picking a readable literal
 * fallback (this file used to hard-code the light literal always, invisible
 * on a dark embed's transparent body). Under a branded dead end the
 * wrapper's theme sets `--foreground`, so the brand's own colour paints;
 * on the neutral path nothing sets it and the literal fallback does.
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
