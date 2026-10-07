"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import { usePublicLocaleDefault } from "@/components/public/locale-context";
import "./form.css";

/**
 * Error boundary for `/f/<publicId>` — moved from `app/f/error.tsx` down
 * INSIDE the shell (F-102 review round, fix 1). A reviewer proved the bug
 * with a built app and a bad service-role key: `app/f/[publicId]/layout.tsx`
 * is the tree's ONLY `<html>` (it moved there to read `params`), so an error
 * boundary sitting ABOVE it — `app/f/error.tsx`, the old location — has no
 * shell to render INTO when something below the layout throws; Next falls
 * back to its own bare `__next_error__` page, with no lang, no fonts, and no
 * transparent body, on the client's own website inside their embed.
 *
 * Colocating this file at `[publicId]` only works BECAUSE the layout now
 * also catches its own read failure (`layout.tsx`'s `loadFormSafe`) rather
 * than throwing — that keeps the shell standing so THIS boundary has
 * somewhere to render. The two fixes are a pair: one guarantees the shell,
 * the other catches what still throws inside it (the page's own call to the
 * same now-rejected cached promise, or anything else in `page.tsx`).
 *
 * Still the same plain CSS as the form itself and nothing else: no
 * dashboard components, no `m` message catalog, no shadcn primitives — this
 * boundary must render even if the failure is somehow in a message-catalog
 * import, and it never names what actually broke.
 *
 * `"use client"` is Next's own requirement for every `error.tsx`, which
 * makes `useSearchParams()` the sanctioned way to read an explicit
 * `?locale=` override here (F-102). Unlike the old location, this one DOES
 * have a real default to fall back to below that: `usePublicLocaleDefault()`
 * reads the SAME value the layout resolved for `<html lang>` (including its
 * own "the read failed" fallback of "en") via context, since neither this
 * component nor `not-found.tsx` receives any props at all to carry it as one.
 */
export default function PublicFormError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useSearchParams();
  const layoutDefault = usePublicLocaleDefault();
  const locale = normalizeLocale(params.get("locale") ?? undefined, layoutDefault);
  const strings = publicStrings(locale);

  useEffect(() => {
    // Logged for developer diagnosis only — the raw message and stack are
    // never surfaced to the visitor.
    console.error(error);
  }, [error]);

  return (
    <div className="bis-form" lang={locale}>
      <p role="alert" className="bis-form-error" style={{ fontSize: 15, marginBottom: 12 }}>
        {strings.unavailable}
      </p>
      <button type="button" onClick={() => reset()} className="bis-form-submit">
        {strings.tryAgain}
      </button>
    </div>
  );
}
