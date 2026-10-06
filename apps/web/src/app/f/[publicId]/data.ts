import { cache } from "react";
import { serviceDb, getFormByPublicId, getBranding, type FormRow, type Branding } from "@bis/db";

/**
 * Shared by `layout.tsx` (lang + not-found branding) and `page.tsx`
 * (content + the live/not-found decision) — React's `cache()` dedupes this
 * to ONE query per request as long as both call the SAME function reference
 * with the same `publicId`, which is why this lives in its own module rather
 * than inside either file: a copy defined separately in each would not
 * share a cache key and would cost a second query per request.
 *
 * Unlike the old `getPublishedFormByPublicId`-backed loader, this returns a
 * draft or archived form too — the layout needs the row's own
 * `locale_default` and `account_id` for a not-found page EVEN when the form
 * is not live. `page.tsx` applies `isFormLive` itself before deciding
 * whether to render or call `notFound()`.
 */
export const loadForm = cache(
  (publicId: string) => getFormByPublicId(serviceDb(), publicId),
);

/** The document's own default language — known even for a draft, so a
 *  not-found page can be correctly `lang`-tagged instead of defaulting to
 *  English just because the form is not live yet. */
export function formLangDefault(form: FormRow | null): "en" | "es" {
  return form?.locale_default ?? "en";
}

/**
 * Shared `cache()`'d branding reader — moved out of `page.tsx` so the layout
 * (not-found chrome) and the page (the live render) ask for the SAME
 * account's branding without a second query. Null on failure rather than
 * throwing, same reasoning as every other caller of `getBranding` on this
 * route: a database blip on this decorative read must never cost a visitor
 * (or, here, a 404 page) anything load-bearing.
 */
export const loadFormBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`public form ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

export const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
