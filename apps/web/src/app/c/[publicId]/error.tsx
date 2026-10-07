"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { conciergeStrings } from "@/lib/concierge/strings";
import { usePublicLocaleDefault } from "@/components/public/locale-context";
import { deadEndTextStyle, deadEndButtonStyle } from "@/components/public/dead-end-style";

/**
 * Error boundary for `/c/<publicId>` — moved from `app/c/error.tsx` down
 * INSIDE the shell (F-102 review round, fix 1). `/c` had NO error boundary
 * at all before this task started (defect :845); colocating the first one
 * directly at the OLD, wrong location would have reproduced the exact bug a
 * reviewer proved on `/f` with a built app and a bad service-role key — see
 * `app/f/[publicId]/error.tsx`'s comment for the full mechanism
 * (`app/c/[publicId]/layout.tsx` is this tree's ONLY `<html>`, so an error
 * boundary above it has no shell to render into).
 *
 * Same plain-inline-style shape as `app/b/error.tsx` and nothing else (no
 * dashboard components, no `m` message catalog, no shadcn primitives), for
 * the identical reason that file gives.
 *
 * `"use client"` is Next's own requirement for every `error.tsx`, which
 * makes `useSearchParams()` the sanctioned way to read `?locale=` here;
 * `usePublicLocaleDefault()` supplies the document's own default (via
 * context, from `layout.tsx`) to fall back to otherwise, and colour routes
 * through `deadEndTextStyle`/`deadEndButtonStyle` — see those files' and
 * `not-found.tsx`'s comments for why.
 */
export default function ConciergeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useSearchParams();
  const layoutDefault = usePublicLocaleDefault();
  const locale = normalizeLocale(params.get("locale") ?? undefined, layoutDefault);
  const strings = conciergeStrings(locale);

  useEffect(() => {
    // Logged for developer diagnosis only — the raw message and stack are
    // never surfaced to the visitor.
    console.error(error);
  }, [error]);

  return (
    <div lang={locale} style={deadEndTextStyle(params.get("theme"))}>
      <p role="alert" style={{ fontSize: 15, marginBottom: 12 }}>
        {strings.unavailable}
      </p>
      <button type="button" onClick={() => reset()} style={deadEndButtonStyle()}>
        {strings.tryAgain}
      </button>
    </div>
  );
}
