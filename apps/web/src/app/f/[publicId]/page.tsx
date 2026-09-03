import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { serviceDb, getPublishedFormByPublicId, getBranding, brandLogoUrl,
         type Branding } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicForm } from "./public-form";
import { PublicBrand } from "@/components/public-brand";
import { submitFormAction } from "./actions";
import "@/styles/public-brand.css";
import "./form.css";

export const dynamic = "force-dynamic";

/**
 * Next invokes generateMetadata and the component below separately for the
 * SAME request, and both need the same two rows. `cache()` makes that one
 * query each rather than two — the technique M3 used to give a client's tab
 * their own title at zero extra cost.
 *
 * This matters more here than on the dashboard: this page is anonymous, it is
 * `force-dynamic`, and it is the one page in the product a client's customers
 * load. Doubling its queries to decorate a browser tab would be a bad trade.
 */
const loadForm = cache(
  (publicId: string) => getPublishedFormByPublicId(serviceDb(), publicId),
);

/**
 * Null on failure rather than throwing, for the reason the component already
 * documents: without the form there is nothing to render, but without the
 * branding there is still a form that captures the lead. A database blip must
 * not cost the client the customer.
 */
const loadBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`public form ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

// Every client's form is reachable only by knowing its opaque publicId, and
// the URL itself is never meant to be a discoverable destination — indexing
// it would let a form (and, via its query string, tracking parameters and
// referrer) surface directly in search results for someone who never visited
// the client's actual site.
//
// Now a function rather than a constant, so the tab can carry the client's
// own icon. `robots` is unchanged and unconditional — it is the one thing
// here that must not depend on a database read succeeding.
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId } = await params;
  const form = await loadForm(publicId);
  if (!form) return { robots };
  const branding = await loadBranding(form.account_id, publicId);
  return {
    robots,
    ...(branding?.brandLogoPath
      ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } }
      : {}),
  };
}

// A plain (non-component) helper so the impure `Date.now()` call is not
// lexically inside the component body: react-hooks/purity flags any impure
// builtin called directly during a component's render, but this Server
// Component is meant to mint a fresh, request-scoped token every time it
// runs — that is the point of `dynamic = "force-dynamic"`, not a bug.
function issueRenderToken(publicId: string): string {
  return signRenderToken(Date.now(), publicId);
}

export default async function PublicFormPage({
  params, searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  const query = await searchParams;
  // Through the cached reader above, so generateMetadata's identical read for
  // this request costs nothing.
  const form = await loadForm(publicId);
  // A draft, an archived form and a token that never existed are the same 404.
  if (!form) notFound();

  // A second read: getPublishedFormByPublicId selects from `forms` alone, so
  // the owning company's branding has to be fetched by the form's account_id.
  // serviceDb() as everywhere else on this route — the visitor is anonymous
  // and has no token of their own.
  //
  // Caught inside loadBranding, unlike the form read above, because the two
  // are not equally important. Without the form there is nothing to render;
  // without the logo there is a form that still captures the lead. Letting a
  // decorative second query send a stranger to f/error.tsx would mean a
  // database blip costs the client the customer — the one thing they are
  // paying us for.
  const branding: Branding = (await loadBranding(form.account_id, publicId)) ?? UNBRANDED;

  const flat = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") flat.set(key, value);
  }

  const locale = normalizeLocale(flat.get("locale") ?? undefined, form.locale_default);
  // The account's theme, not the form's. `theme.mode` and `theme.radius` are
  // still stored and still copied by blueprints, and are deliberately no
  // longer read: a company has one brand, not one per form — the same call
  // that removed the per-form accent picker in the brand-colour milestone.
  // `?theme=` is the host page saying which mode it is in — forwarded by
  // `embed.js` from `data-theme`, or set by a host that builds its own
  // iframe. See `parseHostMode` for what it may and may not override.
  const { style, darkCss, themed } = publicFormTheme(
    branding, form.theme.transparentBackground ?? false, parseHostMode(flat.get("theme")),
  );

  return (
    // The tokens ride on <main>, the one element on this route that paints a
    // surface, and `data-tenant-theme` is both the dark rule's selector and
    // the e2e hook — the same attribute the workspace exposes on <body>.
    <main className="bis-form-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {/* Only a `follow` tenant emits this: the visitor's own device decides,
          which no server-rendered style attribute can answer on its own. */}
      {darkCss ? <style>{darkCss}</style> : null}
      <PublicBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      <PublicForm
        fields={form.fields}
        theme={form.theme}
        locale={locale}
        strings={publicStrings(locale)}
        // Signed server-side at render: a bot that rewrites this to look like a
        // slow human fill fails the signature instead. Bound to this publicId,
        // so a token minted here cannot be replayed against another form.
        renderToken={issueRenderToken(publicId)}
        // Lifted from the host page by embed.js and passed straight through.
        attribution={new URLSearchParams(parseAttribution(flat)).toString()}
        action={submitFormAction.bind(null, publicId)}
      />
    </main>
  );
}
