"use client";

import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { conciergeStrings } from "@/lib/concierge/strings";

/**
 * Colocated at `[publicId]`, which is what lets it replace the framework's
 * own English not-found box for a switched-off concierge, a profile with no
 * destination form, or a public_id that never existed (F-102) — all three
 * reach `notFound()` from `page.tsx`'s one check, and stay the same 404 by
 * design. Before this file, `/c` had no not-found page of its own at all.
 *
 * Same reasoning as `app/f/[publicId]/not-found.tsx` for being a Client
 * Component with zero props, reading `?locale=` via `useSearchParams`, and
 * not attempting the account's branding itself — see that file's comment.
 * `layout.tsx` renders the brand chrome above this, when the account is
 * known but not live.
 */
export default function ConciergeNotFound() {
  const params = useSearchParams();
  const locale = normalizeLocale(params.get("locale") ?? undefined, "en");
  const strings = conciergeStrings(locale);

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
