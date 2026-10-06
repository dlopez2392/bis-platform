"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { conciergeStrings } from "@/lib/concierge/strings";

/**
 * Error boundary for the `/c` segment — the public, unauthenticated chat
 * widget route, reached directly or embedded on a client's own site. `/c`
 * had NO error boundary before this (F-102, defect :845) — a thrown error
 * anywhere in this segment fell through to Next's raw global error page, on
 * the client's own website, inside their widget.
 *
 * Same plain-inline-CSS shape as `app/b/error.tsx` and nothing else (no
 * dashboard components, no `m` message catalog, no shadcn primitives), for
 * the identical reason that file gives: this boundary must render even if
 * the failure is somehow in a message-catalog import, and it never names
 * what actually broke.
 *
 * `"use client"` is Next's own requirement for every `error.tsx`, which
 * makes `useSearchParams()` the sanctioned way to read `?locale=` here
 * (F-102's lang half of defect :845) — see `app/f/error.tsx`'s identical
 * comment for why this is not the client-side `document.documentElement.lang`
 * patch DESIGN.md's first-paint requirement rules out: that requirement is
 * about the `<html>` tag, already set correctly at first paint by
 * `layout.tsx`; this only localizes THIS boundary's own two lines of text.
 */
export default function ConciergeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useSearchParams();
  const locale = normalizeLocale(params.get("locale") ?? undefined, "en");
  const strings = conciergeStrings(locale);

  useEffect(() => {
    // Logged for developer diagnosis only — the raw message and stack are
    // never surfaced to the visitor.
    console.error(error);
  }, [error]);

  return (
    <div style={{
      font: "400 15px/1.5 system-ui, -apple-system, \"Segoe UI\", sans-serif",
      color: "#18181b", padding: 16, maxWidth: 480, margin: "0 auto",
    }}>
      <p role="alert" style={{ fontSize: 15, marginBottom: 12 }}>
        {strings.unavailable}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          font: "inherit", fontWeight: 600, border: "none", borderRadius: "0.5rem",
          background: "#6d28d9", color: "#ffffff", padding: "10px 18px", cursor: "pointer",
        }}
      >
        {strings.tryAgain}
      </button>
    </div>
  );
}
