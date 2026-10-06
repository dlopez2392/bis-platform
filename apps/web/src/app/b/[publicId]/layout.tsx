import type { Metadata } from "next";
import { brandDisplayName, brandLogoUrl } from "@bis/db";
import { PublicBrand } from "@/components/public-brand";
import { publicTabTitle } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import { loadCalendarSafe, isCalendarLive, loadCalendarBranding, UNBRANDED } from "./data";
import "@/styles/public-brand.css";

const FAVICON: Pick<Metadata, "icons"> = { icons: { icon: "/favicon.ico" } };

/**
 * `/b/<publicId>`'s SEGMENT layout — NOT a root layout; `app/b/layout.tsx`
 * still provides this tree's one `<html>`/`<body>`, because a calendar
 * carries no per-document locale default the way a form or a voice profile
 * does (see that file's own comment for why moving the ROOT down would buy
 * nothing for `lang`). This file exists for a DIFFERENT reason (F-102
 * review round, fix 6): `/f` and `/c` brand and theme their not-found page
 * when the account is known but not live, and `/b` did not — always
 * neutral, even for a disabled calendar whose account is perfectly
 * knowable from `publicId`. This layout closes that gap, mirroring
 * `app/f/[publicId]/layout.tsx`'s split exactly, just without an `<html>`
 * of its own to also set `lang` on (the `?locale=`/`<main lang>` story for
 * `/b` is `page.tsx`'s and `cancel/[token]/page.tsx`'s own element-level
 * fix instead — see their comments).
 *
 * Nested UNDER `[publicId]`, this also wraps `cancel/[token]/page.tsx` — a
 * stale or unknown cancel token reaches the SAME not-found page, with the
 * SAME calendar-based brand/theme decision, since the account identified by
 * `publicId` in a cancel link is unrelated to whether the cancel TOKEN
 * itself is good. See this task's report for the one case this does not
 * reach: a cancel link whose calendar is enabled/live gets NO brand on a
 * bad-token 404, because this layout's own `showNotFoundBrand` check
 * assumes a live calendar means `page.tsx` will render (which `cancel`'s
 * page may not, for its own, unrelated reason) — a known, documented gap,
 * not a regression from today's always-neutral behaviour.
 */
export default async function PublicBookingSegmentLayout({
  params, children,
}: {
  params: Promise<{ publicId: string }>;
  children: React.ReactNode;
}) {
  const { publicId } = await params;
  const calendar = await loadCalendarSafe(publicId);
  const showNotFoundBrand = !!calendar && !isCalendarLive(calendar);
  const branding = showNotFoundBrand ? await loadCalendarBranding(calendar.account_id, publicId) : null;
  const theme = branding ? publicFormTheme(branding, false, null) : null;

  if (!(showNotFoundBrand && branding && theme)) return children;

  return (
    <div style={theme.style} {...(theme.themed ? { "data-tenant-theme": "" } : {})}>
      {theme.darkCss ? <style>{theme.darkCss}</style> : null}
      <PublicBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      {children}
    </div>
  );
}

/** Fallback tab title AND icon for the not-found path — see
 *  `app/f/[publicId]/layout.tsx`'s identical `generateMetadata`. Unlike
 *  that file, there is no `lang` concern here (this is not a root layout),
 *  so the fallback strings are plain English, matching `page.tsx`'s own
 *  `"en"` default for this tree. */
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const { publicId } = await params;
  const calendar = await loadCalendarSafe(publicId);
  const strings = bookingStrings("en");
  if (!calendar || isCalendarLive(calendar)) return { title: strings.tabTitleNoBrand, ...FAVICON };
  const branding = (await loadCalendarBranding(calendar.account_id, publicId)) ?? UNBRANDED;
  return {
    title: publicTabTitle(strings, brandDisplayName(branding)),
    ...(branding.brandLogoPath ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } } : FAVICON),
  };
}
