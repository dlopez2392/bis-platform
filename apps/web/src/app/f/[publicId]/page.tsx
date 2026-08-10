import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serviceDb, getPublishedFormByPublicId, getBranding, brandLogoUrl,
         type Branding } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import { resolveFormAccent } from "@/lib/branding/color";
import { PublicForm } from "./public-form";
import { FormBrand } from "./form-brand";
import { submitFormAction } from "./actions";
import "./form.css";

export const dynamic = "force-dynamic";

// Every client's form is reachable only by knowing its opaque publicId, and
// the URL itself is never meant to be a discoverable destination — indexing
// it would let a form (and, via its query string, tracking parameters and
// referrer) surface directly in search results for someone who never visited
// the client's actual site.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
  const form = await getPublishedFormByPublicId(serviceDb(), publicId);
  // A draft, an archived form and a token that never existed are the same 404.
  if (!form) notFound();

  // A second read: getPublishedFormByPublicId selects from `forms` alone, so
  // the owning company's branding has to be fetched by the form's account_id.
  // serviceDb() as everywhere else on this route — the visitor is anonymous
  // and has no token of their own.
  //
  // Caught, unlike the form read above, because the two are not equally
  // important. Without the form there is nothing to render; without the logo
  // there is a form that still captures the lead. Before this page carried a
  // brand it needed exactly one query to succeed, and letting a decorative
  // second query send a stranger to f/error.tsx would mean a database blip
  // costs the client the customer — the one thing they are paying us for.
  let branding: Branding = {
    brandName: null, brandLogoPath: null, brandColor: null,
    brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  };
  try {
    branding = await getBranding(serviceDb(), form.account_id);
  } catch (e) {
    console.error(`public form ${publicId}: branding read failed for account ${form.account_id}: ${String(e)}`);
  }

  const flat = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") flat.set(key, value);
  }

  const locale = normalizeLocale(flat.get("locale") ?? undefined, form.locale_default);
  const accent = resolveFormAccent(branding.brandColor);

  return (
    <main className={form.theme.mode === "dark" ? "dark" : undefined}>
      <FormBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      <PublicForm
        fields={form.fields}
        theme={form.theme}
        accent={accent}
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
