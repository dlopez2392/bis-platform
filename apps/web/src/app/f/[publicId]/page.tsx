import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFormLive, brandDisplayName, brandLogoUrl, type Branding } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { publicStrings, normalizeLocale, publicTabTitle } from "@/lib/forms/public-strings";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicForm } from "./public-form";
import { PublicBrand } from "@/components/public-brand";
import { submitFormAction } from "./actions";
import { loadForm, loadFormSafe, loadFormBranding, UNBRANDED } from "./data";
import "@/styles/public-brand.css";
import "./form.css";

export const dynamic = "force-dynamic";

// Every client's form is reachable only by knowing its opaque publicId, and
// the URL itself is never meant to be a discoverable destination — indexing
// it would let a form (and, via its query string, tracking parameters and
// referrer) surface directly in search results for someone who never visited
// the client's actual site.
//
// `loadForm`/`loadFormBranding` now live in `./data` so `layout.tsx` can ask
// for the SAME rows (React `cache()` dedupes by function reference + args,
// so sharing the module is what makes it one query, not two). `robots` is
// unchanged and unconditional — it is the one thing here that must not
// depend on a database read succeeding. The title is now set here too, for
// the live case; a draft/archived/unknown form falls through to the title
// `layout.tsx`'s own `generateMetadata` computes instead (Next merges a
// page's metadata over its layout's, field by field — a page that returns
// no `title` key inherits the layout's).
//
// Uses `loadFormSafe`, NOT the page component's own `loadForm` below (F-102
// review round, fix 1): `generateMetadata` runs OUTSIDE the render tree
// `error.tsx` boundaries wrap, so a throw here — even though `page.tsx`'s
// own render below has a real boundary to land in — escapes straight to
// Next's bare `__next_error__` page instead. Proved by curling a built app
// with a deliberately invalid `SUPABASE_SERVICE_ROLE_KEY`: fixing only
// `layout.tsx`'s own read was not enough, because this function's unguarded
// `loadForm` call still threw.
export async function generateMetadata(
  { params, searchParams }: {
    params: Promise<{ publicId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId } = await params;
  const form = await loadFormSafe(publicId);
  if (!form || !isFormLive(form)) return { robots };
  const branding = await loadFormBranding(form.account_id, publicId);
  const query = await searchParams;
  const locale = normalizeLocale(
    typeof query.locale === "string" ? query.locale : undefined, form.locale_default,
  );
  return {
    robots,
    title: publicTabTitle(publicStrings(locale), brandDisplayName(branding ?? UNBRANDED)),
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
  // Through the cached reader in `./data`, so `layout.tsx`'s and
  // `generateMetadata`'s identical reads for this request cost nothing.
  // Deliberately the THROWING `loadForm`, not `loadFormSafe` —
  // `generateMetadata` above has no `error.tsx` boundary to land in and so
  // must never throw, but THIS call is inside the page component's own
  // render, which `app/f/[publicId]/error.tsx` (inside the now-standing
  // shell) exists to catch.
  const form = await loadForm(publicId);
  // A draft, an archived form and a token that never existed are the same
  // 404 from the VISITOR's side — `isFormLive` is the status check
  // `getPublishedFormByPublicId`'s SQL filter used to make for this caller,
  // now spelled out so `layout.tsx` can apply it too, against the same row.
  if (!form || !isFormLive(form)) notFound();

  // A second read: `forms` carries no branding of its own, so the owning
  // company's branding has to be fetched by the form's account_id.
  // serviceDb() as everywhere else on this route — the visitor is anonymous
  // and has no token of their own.
  //
  // Caught inside loadFormBranding, unlike the form read above, because the
  // two are not equally important. Without the form there is nothing to
  // render; without the logo there is a form that still captures the lead.
  // Letting a decorative second query send a stranger to f/error.tsx would
  // mean a database blip costs the client the customer — the one thing they
  // are paying us for.
  const branding: Branding = (await loadFormBranding(form.account_id, publicId)) ?? UNBRANDED;

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
    // `lang` here too (F-102 review round, decision): `<html lang>`
    // (`layout.tsx`) carries the FORM's own default, but `locale` here also
    // honors a `?locale=` override the layout can never see, so the two can
    // legitimately disagree — this element is what a screen reader actually
    // reads, and it is always right.
    <main lang={locale} className="bis-form-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
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
