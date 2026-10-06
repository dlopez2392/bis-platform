"use client";

import { useSearchParams } from "next/navigation";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import "./form.css";

/**
 * Colocated at `[publicId]`, which is what lets it replace the framework's
 * own English "This page could not be found" box for a draft, an archived
 * form, or a public_id that never existed (F-102, defect :815) — all three
 * reach `notFound()` from `page.tsx`'s one check, and stay the same 404 by
 * design: this component cannot and must not tell them apart.
 *
 * `"use client"` because Next renders this with NO props at all, same as
 * `error.tsx` — not even `params`, by framework design (not an oversight;
 * see `layout.tsx`'s own comment). A Client Component is the one legitimate
 * way left to read the CURRENT url's `?locale=` (via `useSearchParams`,
 * resolved synchronously on this component's first render, not a delayed
 * effect patching anything after the fact) — the same query `embed.js`
 * forwards and a shared link may carry, which `layout.tsx` cannot see
 * either and so falls back to the document's own default `lang`. This is
 * strictly a REFINEMENT on top of that correct `lang`, not a fix for it:
 * the `<html>` tag is already right by the time this renders.
 *
 * Deliberately NOT branded: the account's logo (when known) is rendered by
 * `layout.tsx`, above this component, from data already fetched for `lang` —
 * a Client Component with zero props has no safe, query-free way to read it
 * itself. See this task's report for the reasoning and the scope note.
 */
export default function PublicFormNotFound() {
  const params = useSearchParams();
  const locale = normalizeLocale(params.get("locale") ?? undefined, "en");
  const strings = publicStrings(locale);

  return (
    <div className="bis-form">
      <p className="bis-form-error" style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
        {strings.notFoundTitle}
      </p>
      <p style={{ fontSize: 15, margin: 0 }}>{strings.notFoundBody}</p>
    </div>
  );
}
