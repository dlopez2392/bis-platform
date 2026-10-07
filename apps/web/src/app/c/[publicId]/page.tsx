import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isConciergeLive, brandDisplayName, brandLogoUrl, type Branding } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { conciergeStrings } from "@/lib/concierge/strings";
import { normalizeLocale, publicTabTitle } from "@/lib/forms/public-strings";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import { ConciergeChat } from "./concierge-chat";
import { loadProfile, loadProfileSafe, loadProfileBranding, UNBRANDED } from "./data";
import "@/styles/public-brand.css";
import "./concierge.css";

export const dynamic = "force-dynamic";

// The chat is reachable only by knowing its opaque publicId, and the URL
// itself is never meant to be a discoverable destination — indexing it would
// surface a client's widget (and, via its query string, tracking parameters
// and referrer) in search results for someone who never visited the client's
// actual site. `robots` is unconditional and NOT dependent on a database
// read succeeding — the one thing here that must not depend on one.
//
// `loadProfile`/`loadProfileBranding` now live in `./data` so `layout.tsx`
// can ask for the SAME rows (one query per request, via React `cache()`).
// The title is set here for the live case; a switched-off/unknown profile
// falls through to the title `layout.tsx`'s own `generateMetadata` computes
// instead (a page's metadata with no `title` key inherits its layout's).
//
// Uses `loadProfileSafe`, NOT the page component's own `loadProfile` below
// (F-102 review round, fix 1) — see `app/f/[publicId]/page.tsx`'s identical
// comment: `generateMetadata` has no `error.tsx` boundary to land in.
export async function generateMetadata(
  { params, searchParams }: {
    params: Promise<{ publicId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId } = await params;
  const profile = await loadProfileSafe(publicId);
  if (!profile || !isConciergeLive(profile)) return { robots };
  const branding = await loadProfileBranding(profile.account_id, publicId);
  const sp = await searchParams;
  const locale = normalizeLocale(
    typeof sp.locale === "string" ? sp.locale : undefined,
    profile.languages === "es" ? "es" : "en",
  );
  return {
    robots,
    title: publicTabTitle(conciergeStrings(locale), brandDisplayName(branding ?? UNBRANDED)),
    ...(branding?.brandLogoPath
      ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } }
      : {}),
  };
}

// A plain (non-component) helper so the impure `Date.now()` call is not
// lexically inside the component body — same reasoning as
// `f/[publicId]/page.tsx`'s identical helper: react-hooks/purity flags any
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
  // Through the cached reader in `./data`, so `layout.tsx`'s and
  // `generateMetadata`'s identical reads for this request cost nothing.
  const profile = await loadProfile(publicId);
  // A switched-off concierge, one with no destination form, and an unknown
  // public id are all the same HTTP STATUS (404) — `isConciergeLive` is the
  // status check `getVoiceProfileByPublicId`'s SQL filter used to make for
  // this caller, now spelled out so `layout.tsx` can apply it too, against
  // the same row. Status parity is not look parity — `layout.tsx` may still
  // brand the first two (the account is known); only a truly unknown
  // public id gets the neutral page (see `getPublishedFormByPublicId`'s doc
  // in `packages/db/src/forms.ts` for why that split is sanctioned).
  if (!profile || !isConciergeLive(profile)) notFound();

  const branding: Branding = (await loadProfileBranding(profile.account_id, publicId)) ?? UNBRANDED;

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
  // `formAccent` is the CTA pair (`{ accent, accentForeground }`) this same
  // call already resolves for the composer's send button — forwarded to
  // ConciergeChat so the loader's launcher can match it via a
  // `bis-concierge-brand` message rather than a second, independent colour
  // decision baked into the cached snippet (Task 5 review, Adopted Minor).
  const { style, darkCss, themed, formAccent } = publicFormTheme(
    branding, false,
    parseHostMode(typeof sp.theme === "string" ? sp.theme : undefined),
  );

  return (
    // The tokens ride on <main>, the one element on this route that paints a
    // surface; `data-tenant-theme` is both the dark rule's selector and the
    // e2e hook, exactly as the public form and the booking page do it.
    // `lang` here too (F-102 review round, decision) — see
    // `app/f/[publicId]/page.tsx`'s identical comment for why this can
    // legitimately differ from `<html lang>` when `?locale=` overrides it.
    <main lang={locale} className="bis-concierge" style={style}
          {...(themed ? { "data-tenant-theme": "" } : {})}>
      {/* Only a `follow` tenant emits this: the visitor's own device decides,
          which no server-rendered style attribute can answer on its own. */}
      {darkCss ? <style>{darkCss}</style> : null}
      <ConciergeChat
        publicId={publicId}
        greeting={greeting}
        locale={locale}
        strings={strings}
        renderToken={issueRenderToken(publicId)}
        attribution={parseAttribution(query)}
        bare={query.get("chrome") === "bare"}
        brandAccent={formAccent.accent}
        brandAccentForeground={formAccent.accentForeground}
        brand={
          <PublicBrand
            name={branding.brandName}
            logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
          />
        }
      />
      <p className="bis-concierge-footer">{strings.poweredBy}</p>
    </main>
  );
}
