"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import "./[publicId]/form.css";

/**
 * Error boundary for the `/f` segment — the public, unauthenticated form
 * route embedded on a client's own site. Uses the same plain CSS as the form
 * itself and nothing else: no dashboard components, no `m` message catalog,
 * no shadcn primitives. That mirrors why `app/f/[publicId]/layout.tsx` does
 * not inherit the dashboard's root layout.
 *
 * Without this file, a thrown error anywhere in this segment (a failed form
 * lookup, a guard's DB call escaping `actions.ts`) falls through to Next's
 * raw global error page — on the client's own website, inside their embed.
 *
 * `"use client"` is Next's own requirement for every `error.tsx`, which
 * makes `useSearchParams()` the sanctioned way to read `?locale=` here
 * (F-102) — unlike `not-found.tsx`, this file does not also need to fall
 * back to a document default: an error means the form's own `locale_default`
 * was never successfully read either, so "en" is genuinely the best
 * available default, not a guess standing in for a known value.
 */
export default function PublicFormError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useSearchParams();
  const locale = normalizeLocale(params.get("locale") ?? undefined, "en");
  const strings = publicStrings(locale);

  useEffect(() => {
    // Logged for developer diagnosis only — the raw message and stack are
    // never surfaced to the visitor.
    console.error(error);
  }, [error]);

  return (
    <div className="bis-form">
      <p role="alert" className="bis-form-error" style={{ fontSize: 15, marginBottom: 12 }}>
        {strings.unavailable}
      </p>
      <button type="button" onClick={() => reset()} className="bis-form-submit">
        {strings.tryAgain}
      </button>
    </div>
  );
}
