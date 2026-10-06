"use client";

import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";

/**
 * Replaces the framework's own English not-found box for a disabled or
 * unknown calendar, AND for a stale/unknown cancel link — both
 * `app/b/[publicId]/page.tsx` and `.../cancel/[token]/page.tsx` call
 * `notFound()` under this one tree, and (unlike `/f` and `/c`) there is no
 * `[publicId]`-level layout here to colocate a narrower one against: a
 * calendar carries no per-document locale default (see `app/b/layout.tsx`'s
 * own comment), so there would be nothing to gain from moving this one
 * level down.
 *
 * Same reasoning as `app/f/[publicId]/not-found.tsx` for being a Client
 * Component with zero props reading `?locale=` via `useSearchParams`, and
 * NOT attempting the account's branding — `/b`'s layout has no `[publicId]`
 * segment to read the account from either, so this not-found page is always
 * neutral, matching rule 9's login precedent ("there is no account whose
 * brand could be read").
 */
export default function PublicBookingNotFound() {
  const params = useSearchParams();
  const locale = normalizeLocale(params.get("locale") ?? undefined, "en");
  const strings = bookingStrings(locale);

  return (
    <div style={{
      font: "400 15px/1.5 system-ui, -apple-system, \"Segoe UI\", sans-serif",
      color: "#18181b", padding: 16, maxWidth: 480, margin: "0 auto",
    }}>
      <p role="alert" style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
        {strings.notFoundTitle}
      </p>
      <p style={{ fontSize: 15, margin: 0 }}>{strings.notFoundBody}</p>
    </div>
  );
}
