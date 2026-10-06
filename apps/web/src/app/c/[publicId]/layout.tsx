import type { Metadata } from "next";
import { isConciergeLive, brandDisplayName, brandLogoUrl } from "@bis/db";
import { PublicHtml } from "@/components/public/public-html";
import { PublicBrand } from "@/components/public-brand";
import { conciergeStrings } from "@/lib/concierge/strings";
import { publicTabTitle } from "@/lib/forms/public-strings";
import { loadProfile, profileLangDefault, loadProfileBranding, UNBRANDED } from "./data";
import "@/styles/public-brand.css";

/**
 * `/c/<publicId>`'s root layout — moved DOWN from `app/c/layout.tsx` for the
 * same reason, and with the same split, as `app/f/[publicId]/layout.tsx`
 * (read that file's comment first). `lang` comes from the profile's own
 * `languages` default, known even while the concierge is off; the account's
 * brand is shown here ONLY when the profile is known but not live, so it is
 * never rendered twice against a live page's own `<PublicBrand>`.
 *
 * `/c` had NO root layout file of its own task history until the chat
 * tree needed one for the SAME reason `app/b/layout.tsx`'s own comment
 * records — without it there is no `<html>`/`<body>` at all on this route.
 */
export default async function ConciergeSegmentLayout({
  params, children,
}: {
  params: Promise<{ publicId: string }>;
  children: React.ReactNode;
}) {
  const { publicId } = await params;
  const profile = await loadProfile(publicId);
  const lang = profileLangDefault(profile);
  const showNotFoundBrand = !!profile && !isConciergeLive(profile);
  const branding = showNotFoundBrand ? await loadProfileBranding(profile.account_id, publicId) : null;

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

/** Fallback tab title for the not-found path — see
 *  `app/f/[publicId]/layout.tsx`'s identical `generateMetadata`. */
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const { publicId } = await params;
  const profile = await loadProfile(publicId);
  const lang = profileLangDefault(profile);
  const strings = conciergeStrings(lang);
  if (!profile || isConciergeLive(profile)) return { title: strings.tabTitleNoBrand };
  const branding = (await loadProfileBranding(profile.account_id, publicId)) ?? UNBRANDED;
  return { title: publicTabTitle(strings, brandDisplayName(branding)) };
}
