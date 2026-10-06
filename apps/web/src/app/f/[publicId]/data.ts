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
 * That "one query" claim holds for a LIVE render. It does NOT hold for a
 * 404: Next 16 renders `notFound()`'s result in a SECOND pass (confirmed by
 * reading `next/dist/server/app-render` — the not-found tree is a distinct
 * render from the one that threw), and `cache()`'s memoization does not
 * carry across that second pass. A draft/archived/unknown form therefore
 * costs TWO reads of this row — once in the pass that discovers it is not
 * live, once again when the layout and `not-found.tsx` render the fallback
 * — not one. Accepted (F-102 review round, item 10): the alternative is a
 * request-scoped cache keyed on something OTHER than React's own `cache()`,
 * which is more machinery than a 404 page is worth.
 *
 * Also worth saying plainly, and VERIFIED against a built app (`next build`
 * + `next start`, curled directly — not inferred): the "first paint already
 * has the right `<html lang>`" claim this whole task makes is true for a
 * LIVE (200) page ONLY. For a `notFound()` call OR an uncaught error, Next
 * 16's INITIAL HTTP response — the bytes a plain `curl`, a screen reader
 * that doesn't run JS, or a translation prompt reading on first load would
 * see — is `<html id="__next_error__">`: a generic, English, unstyled
 * fallback shell with none of `PublicHtml`'s `lang`, fonts, or transparent
 * body, REGARDLESS of how correctly `not-found.tsx`/`error.tsx` are wired.
 * Confirmed identically on `/f`, `/b` and `/c` with a genuinely unknown id
 * (a real 404, no DB error at all — nothing logged server-side) and
 * confirmed the OPPOSITE on an existing 200-status route (`/u/[token]`,
 * which DOES serve `<html lang="en">` at first byte). The correctly
 * localized/branded `not-found.tsx`/`error.tsx` content this task builds IS
 * present — embedded in the same response's Flight payload — but it only
 * PAINTS after client-side JS hydrates and the App Router takes over; it is
 * not in the initial document. This is Next's own behavior for the
 * `notFound()`/thrown-error conventions specifically (not a routing-level
 * "no segment matched" 404, which DOES render fully server-side — the
 * dashboard's own catch-all 404 confirms this: no `__next_error__`, because
 * nothing ever called `notFound()`), and nothing this task's layout/
 * boundary restructuring can change: moving `error.tsx` inside the shell
 * and making every read safe (F-102 review round, fix 1) are still real,
 * confirmed fixes — the OLD bug was an uncaught exception from
 * `generateMetadata` (no boundary of any kind, not even a deferred one);
 * the response now always carries a legitimate, correctly-localized
 * fallback for the client to hydrate into, which it did not before. First
 * paint of a 404/error response specifically is simply not something a
 * page's own code controls in Next 16 — flagged for the ledger, not solved
 * here.
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

/**
 * Every caller of `loadForm` on this route goes through THIS, not `loadForm`
 * directly (F-102 review round, fix 1 — widened from just `layout.tsx` after
 * a live build+curl check against this exact fix showed the bug survived
 * it). `loadForm` is `cache()`'d, so a rejection is cached too: EVERY caller
 * with the same `publicId` re-throws the identical rejected promise. That
 * includes `page.tsx`'s own `generateMetadata`, which is a SEPARATE function
 * from the page component and from `layout.tsx`'s `generateMetadata` — and
 * Next does not wrap metadata generation in the same `error.tsx` boundary
 * machinery that wraps a component's render. A throw from ANY
 * `generateMetadata` escapes straight past every `error.tsx` in the tree to
 * Next's own top-level `__next_error__` handler (confirmed by curling a
 * built app with a deliberately invalid `SUPABASE_SERVICE_ROLE_KEY`: moving
 * the layout's OWN read behind a try/catch was not enough on its own —
 * `page.tsx`'s unguarded `generateMetadata` still produced the bare shell).
 * The fix is the same shape everywhere metadata reads this row: never let
 * `generateMetadata` throw at all. Only the PAGE COMPONENT's own call is
 * allowed to throw — that one DOES have a real boundary
 * (`app/f/[publicId]/error.tsx`) to land in.
 */
export async function loadFormSafe(publicId: string): Promise<FormRow | null> {
  try {
    return await loadForm(publicId);
  } catch (e) {
    console.error(`/f/${publicId}: form read failed: ${String(e)}`);
    return null;
  }
}

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
