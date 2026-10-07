"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { deadEndTextStyle, deadEndButtonStyle } from "@/components/public/dead-end-style";

/**
 * Error boundary for the `/b` segment — the public, unauthenticated booking
 * route reached directly by a stranger with the link. Same reasoning as
 * `app/f/[publicId]/error.tsx`, adapted: inline CSS, no `m` message catalog
 * (this boundary must render even if the failure is somehow in a message-
 * catalog import), no shadcn primitives, and nothing that names what
 * actually broke. Stays at the ROOT of `/b` (unlike `/f`'s and `/c`'s,
 * which moved — F-102 review round, fix 1): `app/b/layout.tsx` is already
 * this tree's `<html>` and does no data read of its own, so it cannot
 * strand the shell the way a moved-down layout's own throw could; this
 * file sitting above the new `app/b/[publicId]/layout.tsx` still catches
 * anything that layout or `page.tsx` throws, rendered INSIDE the
 * already-standing shell.
 *
 * Without this file, a thrown error anywhere in this segment (a failed
 * calendar lookup, `loadTimezone`'s now-rethrown account-read failure — see
 * I3) falls through to Next's raw global error page, on a route a real
 * person is looking at expecting to book an appointment.
 *
 * `"use client"` is Next's own requirement for every `error.tsx`, which
 * makes `useSearchParams()` the sanctioned way to read `?locale=` here
 * (F-102) — no per-document default to fall back to otherwise (same
 * reasoning `app/b/not-found.tsx` gives), so "en" stands.
 *
 * Colour routes through `deadEndTextStyle`/`deadEndButtonStyle` (F-102
 * review round, fix 5) instead of the bare hex literals this file used to
 * carry — see those functions' own comments for why.
 */
export default function PublicBookingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useSearchParams();
  const locale = normalizeLocale(params.get("locale") ?? undefined, "en");
  const strings = bookingStrings(locale);

  useEffect(() => {
    // Logged for developer diagnosis only — the raw message and stack are
    // never surfaced to the visitor.
    console.error(error);
  }, [error]);

  return (
    <div lang={locale} style={deadEndTextStyle(params.get("theme"))}>
      <p role="alert" style={{ fontSize: 15, marginBottom: 12 }}>
        {strings.genericError}
      </p>
      <button type="button" onClick={() => reset()} style={deadEndButtonStyle()}>
        {strings.tryAgain}
      </button>
    </div>
  );
}
