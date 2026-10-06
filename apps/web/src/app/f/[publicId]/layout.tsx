import type { Metadata } from "next";
import { isFormLive, brandDisplayName, brandLogoUrl } from "@bis/db";
import { PublicHtml } from "@/components/public/public-html";
import { PublicBrand } from "@/components/public-brand";
import { PublicLocaleProvider } from "@/components/public/locale-context";
import { publicStrings, publicTabTitle } from "@/lib/forms/public-strings";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import { loadFormSafe, formLangDefault, loadFormBranding, UNBRANDED } from "./data";
import "@/styles/public-brand.css";

const FAVICON: Pick<Metadata, "icons"> = { icons: { icon: "/favicon.ico" } };

/**
 * `/f/<publicId>`'s root layout — moved DOWN from `app/f/layout.tsx` (a
 * segment above every `[publicId]`) to exactly this dynamic segment, which
 * is what lets it read `params.publicId` at all: a root layout at `app/f/`
 * never receives it, and never receives `searchParams` either way (neither
 * does this one — Next does not pass search params to ANY layout, by
 * design, so the `?locale=` override a host embed or a shared link may
 * carry is NOT visible here; see this task's report for why that is a
 * genuine platform limit, not an oversight). `PublicLocaleProvider` carries
 * the default this layout DID resolve down to `not-found.tsx`/`error.tsx`,
 * which can still read `?locale=` themselves (they are Client Components)
 * and let it outrank this default, same ordering the live page already uses.
 *
 * What a layout CAN read is `params`, so it can ask the SAME cached row
 * `page.tsx` asks for (`loadForm`, deduped by React's `cache()` to one query
 * per request) and use the document's OWN `locale_default` for `<html
 * lang>` — correct at first paint, including for a draft or archived form,
 * which is strictly better than the "en" this route always rendered before.
 *
 * It also renders the account's brand — logo, name, AND the SAME tenant
 * theme (`publicFormTheme`) the live page paints on `<main>` — ABOVE
 * `{children}` when, and ONLY when, the form is known but not live: a live
 * render already shows its own themed `<main>` (see `page.tsx`), and
 * showing it again here would duplicate it. A fully unknown public id
 * renders no brand and no theme at all — "branded when the account is
 * known, neutral when the token never existed" (F-102; see
 * `packages/db/src/forms.ts`'s `getPublishedFormByPublicId` doc for why that
 * is a sanctioned distinction and not a leak, now that it is one — danlo,
 * F-102 review round).
 */
export default async function PublicFormSegmentLayout({
  params, children,
}: {
  params: Promise<{ publicId: string }>;
  children: React.ReactNode;
}) {
  const { publicId } = await params;
  const form = await loadFormSafe(publicId);
  const lang = formLangDefault(form);
  const showNotFoundBrand = !!form && !isFormLive(form);
  const branding = showNotFoundBrand ? await loadFormBranding(form.account_id, publicId) : null;
  // No `?theme=` here for the same reason `?locale=` is unavailable — this
  // paints the account's OWN stored `brand_mode`, not a host page's hint.
  const theme = branding ? publicFormTheme(branding, false, null) : null;

  return (
    <PublicHtml lang={lang}>
      <PublicLocaleProvider lang={lang}>
        {showNotFoundBrand && branding && theme ? (
          <div style={theme.style} {...(theme.themed ? { "data-tenant-theme": "" } : {})}>
            {theme.darkCss ? <style>{theme.darkCss}</style> : null}
            <PublicBrand
              name={branding.brandName}
              logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
            />
            {children}
          </div>
        ) : children}
      </PublicLocaleProvider>
    </PublicHtml>
  );
}

/**
 * The fallback tab title AND icon — used only when `page.tsx`'s own
 * `generateMetadata` does not set them, which is exactly the not-found path
 * (a draft, archived, or unknown form; the live page sets its own `icons`
 * only when the account has a logo, so this is also what a live, unbranded
 * account's tab shows). Localized to the document's own default language,
 * and branded when the account is known, same split as the layout above —
 * and the same own-read-failure guard, for the same reason: this function
 * runs independently of the layout component and shares only the cached
 * promise, not a try/catch.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const { publicId } = await params;
  const form = await loadFormSafe(publicId);
  const lang = formLangDefault(form);
  const strings = publicStrings(lang);
  if (!form || isFormLive(form)) return { title: strings.tabTitleNoBrand, ...FAVICON };
  const branding = (await loadFormBranding(form.account_id, publicId)) ?? UNBRANDED;
  return {
    title: publicTabTitle(strings, brandDisplayName(branding)),
    ...(branding.brandLogoPath ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } } : FAVICON),
  };
}
