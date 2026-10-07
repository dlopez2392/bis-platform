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
 * own comment), so moving `<html>` down would gain `lang` nothing.
 *
 * `/b`'s not-found is, and stays, PLAINLY NEUTRAL — localized (via
 * `?locale=`) and token-routed (via `deadEndTextStyle`, honoring
 * `?theme=`), but never branded with the account's logo or colour, unlike
 * `/f`'s and `/c`'s. A non-root `app/b/[publicId]/layout.tsx` briefly
 * attempted that branding (F-102 review round, fix 6) — REMOVED (owner
 * decision, second review round) after a reviewer proved on a built app
 * that `notFound()` is caught by THIS file, which sits ABOVE that segment
 * layout in the tree and REPLACES it entirely: the layout's own
 * `generateMetadata` DID run (the tab title changed), but the layout
 * COMPONENT never got a chance to wrap anything in brand chrome — a
 * disabled calendar's 404 showed no logo at all, confirmed with a headless
 * browser against a seeded disabled calendar. Even fixed, that layout
 * would have cost a real DB query on every `/b/[publicId]/cancel/[token]`
 * request too (it nested under there), and would have wrapped a WORKING
 * cancel page in a second brand header whenever the calendar happened to
 * be disabled with bookings still live on it. Branded `/b` dead ends are
 * now a separate, tracked defect — not solved by resurrecting that file;
 * see `app/b/[publicId]/data.ts`'s own comment for the full writeup.
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
 * on a dark embed's transparent body). There is no themed ancestor to
 * inherit a REAL brand colour from, by the design above, so the literal
 * fallback is always what paints here.
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
