import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { serviceDb, getVoiceProfileByPublicId, getBranding, brandLogoUrl,
         type Branding } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { conciergeStrings } from "@/lib/concierge/strings";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import { ConciergeChat } from "./concierge-chat";
import "@/styles/public-brand.css";
import "./concierge.css";

export const dynamic = "force-dynamic";

/**
 * Next invokes generateMetadata and the component below separately for the
 * SAME request, and both need the same row — `cache()` makes that one query
 * rather than two, the same technique `f/[publicId]/page.tsx` uses and for
 * the same reason: this page is anonymous, `force-dynamic`, and loaded by a
 * client's own customers.
 */
const loadProfile = cache(
  (publicId: string) => getVoiceProfileByPublicId(serviceDb(), publicId),
);

/**
 * Null on failure rather than throwing, for the reason `f/[publicId]/page.tsx`
 * already documents: without the profile there is nothing to render, but
 * without the branding there is still a chat that captures the lead. A
 * database blip must not cost the client the customer.
 */
const loadBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`concierge ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

// The chat is reachable only by knowing its opaque publicId, and the URL
// itself is never meant to be a discoverable destination — indexing it would
// surface a client's widget (and, via its query string, tracking parameters
// and referrer) in search results for someone who never visited the client's
// actual site. `robots` is unconditional and NOT dependent on a database
// read succeeding — the one thing here that must not depend on one.
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId } = await params;
  const profile = await loadProfile(publicId);
  if (!profile) return { robots };
  const branding = await loadBranding(profile.account_id, publicId);
  return {
    robots,
    title: branding?.brandName ?? "Chat",
    ...(branding?.brandLogoPath
      ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } }
      : {}),
  };
}

// A plain (non-component) helper so the impure `Date.now()` call is not
// lexically inside the component body — same reasoning as
// `f/[publicId]/page.tsx`'s `issueRenderToken`: react-hooks/purity flags any
// impure builtin called directly during a component's render, but this
// Server Component is meant to mint a fresh, request-scoped token every time
// it runs, which is the point of `dynamic = "force-dynamic"`, not a bug.
function issueRenderToken(publicId: string): string {
  return signRenderToken(Date.now(), publicId);
}

export default async function ConciergePage({
  params, searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  const sp = await searchParams;
  // Through the cached reader above, so generateMetadata's identical read for
  // this request costs nothing.
  const profile = await loadProfile(publicId);
  // An unknown public id and a profile whose concierge is off are the same
  // 404 — getVoiceProfileByPublicId already folds both into one null.
  if (!profile) notFound();

  const branding: Branding = (await loadBranding(profile.account_id, publicId)) ?? UNBRANDED;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.set(key, value);
  }

  const locale = normalizeLocale(
    query.get("locale") ?? undefined,
    profile.languages === "es" ? "es" : "en",
  );
  const strings = conciergeStrings(locale);
  const greeting = locale === "es" ? profile.greeting_es : profile.greeting_en;

  // Real signatures, read from the source rather than assumed:
  //   publicFormTheme(branding, transparent, hostMode) returns
  //     { style, darkCss, themed } — it is NOT a style object on its own
  //     (apps/web/src/lib/branding/public-form-theme.ts:106-124,234-236).
  //   signRenderToken(nowMs, publicId) — nowMs FIRST
  //     (apps/web/src/lib/forms/guards.ts:54-56).
  //   brandLogoUrl(path) takes the PATH string, not the Branding object
  //     (packages/db/src/branding.ts).
  // `darkCss` is not optional decoration: it is how a `follow` tenant renders
  // dark at all, which no server-rendered style attribute can decide.
  // Dropping it fails DESIGN.md's "renders correctly in dark AND light". The
  // concierge has no form/embed transparency in scope, so `transparent` is
  // always false — this is a standalone widget page, not a form dropped into
  // a host page's own background.
  const { style, darkCss, themed } = publicFormTheme(
    branding, false,
    parseHostMode(typeof sp.theme === "string" ? sp.theme : undefined),
  );

  return (
    // The tokens ride on <main>, the one element on this route that paints a
    // surface; `data-tenant-theme` is both the dark rule's selector and the
    // e2e hook, exactly as the public form and the booking page do it.
    <main className="bis-concierge" style={style}
          {...(themed ? { "data-tenant-theme": "" } : {})}>
      {/* Only a `follow` tenant emits this: the visitor's own device decides,
          which no server-rendered style attribute can answer on its own. */}
      {darkCss ? <style>{darkCss}</style> : null}
      <PublicBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      <ConciergeChat
        publicId={publicId}
        greeting={greeting}
        locale={locale}
        strings={strings}
        renderToken={issueRenderToken(publicId)}
        attribution={parseAttribution(query)}
      />
      <p className="bis-concierge-footer">{strings.poweredBy}</p>
    </main>
  );
}
