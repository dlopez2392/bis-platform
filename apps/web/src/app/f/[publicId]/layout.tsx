import type { Metadata } from "next";
import { isFormLive, brandDisplayName, brandLogoUrl } from "@bis/db";
import { PublicHtml } from "@/components/public/public-html";
import { PublicBrand } from "@/components/public-brand";
import { publicStrings, publicTabTitle } from "@/lib/forms/public-strings";
import { loadForm, formLangDefault, loadFormBranding, UNBRANDED } from "./data";
import "@/styles/public-brand.css";

/**
 * `/f/<publicId>`'s root layout — moved DOWN from `app/f/layout.tsx` (a
 * segment above every `[publicId]`) to exactly this dynamic segment, which
 * is what lets it read `params.publicId` at all: a root layout at `app/f/`
 * never receives it, and never receives `searchParams` either way (neither
 * does this one — Next does not pass search params to ANY layout, by
 * design, so the `?locale=` override a host embed or a shared link may
 * carry is NOT visible here; see this task's report for why that is a
 * genuine platform limit, not an oversight).
 *
 * What a layout CAN read is `params`, so it can ask the SAME cached row
 * `page.tsx` asks for (`loadForm`, deduped by React's `cache()` to one query
 * per request) and use the document's OWN `locale_default` for `<html
 * lang>` — correct at first paint, including for a draft or archived form,
 * which is strictly better than the "en" this route always rendered before.
 *
 * It also renders the account's brand (logo + name) ABOVE `{children}`
 * when, and ONLY when, the form is known but not live: a live render
 * already shows its own `<PublicBrand>` inside `<main>` (see `page.tsx`),
 * and showing it again here would duplicate it. A fully unknown public id
 * renders no brand at all — "branded when the account is known, neutral
 * when the token never existed" (F-102).
 */
export default async function PublicFormSegmentLayout({
  params, children,
}: {
  params: Promise<{ publicId: string }>;
  children: React.ReactNode;
}) {
  const { publicId } = await params;
  const form = await loadForm(publicId);
  const lang = formLangDefault(form);
  const showNotFoundBrand = !!form && !isFormLive(form);
  const branding = showNotFoundBrand ? await loadFormBranding(form.account_id, publicId) : null;

  return (
    <PublicHtml lang={lang}>
      {showNotFoundBrand && branding ? (
        <PublicBrand
          name={branding.brandName}
          logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
        />
      ) : null}
      {children}
    </PublicHtml>
  );
}

/**
 * The fallback tab title — used only when `page.tsx`'s own
 * `generateMetadata` does not set one, which is exactly the not-found path
 * (a draft, archived, or unknown form). Localized to the document's own
 * default language, and branded when the account is known, same split as
 * the layout component above.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const { publicId } = await params;
  const form = await loadForm(publicId);
  const lang = formLangDefault(form);
  const strings = publicStrings(lang);
  if (!form || isFormLive(form)) return { title: strings.tabTitleNoBrand };
  const branding = (await loadFormBranding(form.account_id, publicId)) ?? UNBRANDED;
  return { title: publicTabTitle(strings, brandDisplayName(branding)) };
}
