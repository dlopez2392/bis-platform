"use client";

import { useSearchParams } from "next/navigation";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import { usePublicLocaleDefault } from "@/components/public/locale-context";
import "./form.css";

/**
 * Colocated at `[publicId]`, which is what lets it replace the framework's
 * own English "This page could not be found" box for a draft, an archived
 * form, or a public_id that never existed (F-102, defect :815) — all three
 * reach `notFound()` from `page.tsx`'s one check, and all three answer with
 * the SAME HTTP STATUS (404). They are no longer required to look identical:
 * `layout.tsx` wraps this component in the account's brand and theme when
 * the document is known but not live, and leaves it plain when the
 * public_id never existed at all (see `packages/db/src/forms.ts`'s
 * `getPublishedFormByPublicId` doc for why that split is sanctioned, not a
 * leak — owner decision, F-102 review round). This component's OWN text —
 * the two lines below — is identical either way, by design: the copy must
 * not hint at which of "draft", "archived" or "never existed" it is.
 *
 * `"use client"` because Next renders this with NO props at all, same as
 * `error.tsx` — not even `params`, by framework design (not an oversight;
 * see `layout.tsx`'s own comment). A Client Component is the one legitimate
 * way left to read the CURRENT url's `?locale=` (via `useSearchParams`,
 * resolved synchronously on this component's first render, not a delayed
 * effect patching anything after the fact) — the same query `embed.js`
 * forwards and a shared link may carry. `usePublicLocaleDefault()` supplies
 * what to fall back to when `?locale=` is absent: the document's OWN
 * default, threaded down from `layout.tsx` via context (not hard-coded
 * "en" — a Spanish-default draft form's not-found page used to render its
 * two lines in English regardless; F-102 review round, fix 3). `lang` on
 * this wrapper, not just on `<html>` (which cannot see `?locale=` either),
 * is what keeps the TEXT's own language attribute right even when an
 * override disagrees with the document default `<html lang>` carries.
 *
 * Colour and radius route entirely through the tokens `form.css` already
 * declares (`var(--form-error, …)`, `var(--foreground, …)` by way of
 * `.bis-form`) — `layout.tsx`'s themed wrapper sets those custom properties
 * when branded, which this component inherits for free; the literal
 * fallbacks after the comma are what paint when there is no brand at all.
 */
export default function PublicFormNotFound() {
  const params = useSearchParams();
  const layoutDefault = usePublicLocaleDefault();
  const locale = normalizeLocale(params.get("locale") ?? undefined, layoutDefault);
  const strings = publicStrings(locale);

  return (
    <div className="bis-form" lang={locale}>
      <p role="alert" className="bis-form-error" style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
        {strings.notFoundTitle}
      </p>
      <p style={{ fontSize: 15, margin: 0 }}>{strings.notFoundBody}</p>
    </div>
  );
}
