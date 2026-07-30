import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serviceDb, getPublishedFormByPublicId } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import { PublicForm } from "./public-form";
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

  const flat = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") flat.set(key, value);
  }

  const locale = normalizeLocale(flat.get("locale") ?? undefined, form.locale_default);

  return (
    <main className={form.theme.mode === "dark" ? "dark" : undefined}>
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
