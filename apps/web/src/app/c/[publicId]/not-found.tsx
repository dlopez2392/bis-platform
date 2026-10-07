"use client";

import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { conciergeStrings } from "@/lib/concierge/strings";
import { usePublicLocaleDefault } from "@/components/public/locale-context";
import { deadEndTextStyle } from "@/components/public/dead-end-style";

/**
 * Colocated at `[publicId]`, which is what lets it replace the framework's
 * own English not-found box for a switched-off concierge, a profile with no
 * destination form, or a public_id that never existed (F-102) — all three
 * reach `notFound()` from `page.tsx`'s one check, and all three answer with
 * the SAME HTTP STATUS (404), though not necessarily the same look —
 * `layout.tsx` brands and themes this component when the account is known
 * but not live (see that file's comment, and
 * `packages/db/src/forms.ts`'s `getPublishedFormByPublicId` doc for why).
 * Before this file, `/c` had no not-found page of its own at all.
 *
 * Same reasoning as `app/f/[publicId]/not-found.tsx` for being a Client
 * Component with zero props reading `?locale=` via `useSearchParams`, with
 * `usePublicLocaleDefault()` supplying what to fall back to when it is
 * absent (the document's OWN default, threaded down from `layout.tsx` via
 * context — not hard-coded "en"). `lang` on this wrapper carries that
 * resolved value into the first server-rendered HTML, same as `<html lang>`
 * does for the whole document, which cannot see `?locale=` either.
 *
 * Colour routes through `deadEndTextStyle` (F-102 review round, fix 5):
 * `var(--foreground, …)` so a known account's real brand colour (set by
 * `layout.tsx`'s themed wrapper, inherited here) wins when present, and a
 * `?theme=dark` host's dark literal fallback wins otherwise — never a bare
 * hex, and never invisible-dark-on-nothing on a dark embed.
 */
export default function ConciergeNotFound() {
  const params = useSearchParams();
  const layoutDefault = usePublicLocaleDefault();
  const locale = normalizeLocale(params.get("locale") ?? undefined, layoutDefault);
  const strings = conciergeStrings(locale);

  return (
    <div lang={locale} style={deadEndTextStyle(params.get("theme"))}>
      <p role="alert" style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
        {strings.notFoundTitle}
      </p>
      <p style={{ fontSize: 15, margin: 0 }}>{strings.notFoundBody}</p>
    </div>
  );
}
