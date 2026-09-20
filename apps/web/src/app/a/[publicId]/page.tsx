import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  serviceDb, getAssistantByPublicId, getBranding, brandLogoUrl, type Branding,
} from "@bis/db";
import { signRenderToken } from "@/lib/forms/guards";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { assistantStrings } from "@/lib/assistant/public-strings";
import { AssistantWidget } from "./assistant-widget";
import "@/styles/public-brand.css";
import "./assistant.css";

export const dynamic = "force-dynamic";

/**
 * Same `cache()` technique `f/[publicId]/page.tsx` and `b/[publicId]/page.tsx`
 * both use, for the same reason: `generateMetadata` and the component below
 * run separately against the SAME request and both need this row. One query,
 * not two, on a route that is anonymous, `force-dynamic`, and — via
 * `assistant.js` — loaded on every page of every client's site that has
 * switched the widget on.
 */
const loadAssistant = cache(
  (publicId: string) => getAssistantByPublicId(serviceDb(), publicId),
);

/** Null on failure, same reasoning as the sibling form and booking pages:
 *  without the assistant row there is nothing to render, but without the
 *  branding there is still an assistant that can chat. A database blip on
 *  the decorative read must never cost the client a conversation. */
const loadBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`assistant ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

// Same reasoning as `f/[publicId]/page.tsx` and `b/[publicId]/page.tsx`: an
// assistant is reachable only by knowing its opaque publicId, and this URL —
// carrying `?page=`/`?ref=`/utm_* lifted off a client's own site — is never
// meant to be a discoverable destination.
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId } = await params;
  const assistant = await loadAssistant(publicId);
  if (!assistant) return { robots };
  const branding = await loadBranding(assistant.account_id, publicId);
  return {
    robots,
    ...(branding?.brandLogoPath
      ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } }
      : {}),
  };
}

// A plain (non-component) helper, not inline in the component body, for the
// same react-hooks/purity reason `f/[publicId]/page.tsx`'s `issueRenderToken`
// exists: this Server Component is `force-dynamic` specifically so it mints
// a fresh, request-scoped token on every render.
function issueRenderToken(publicId: string): string {
  return signRenderToken(Date.now(), publicId);
}

export default async function AssistantPage({
  params, searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  const query = await searchParams;
  const assistant = await loadAssistant(publicId);
  // A disabled assistant, a deleted account and a publicId that never existed
  // are all the same 404 — `getAssistantByPublicId` already filters on
  // `enabled = true` (see its own doc comment), so a null result here covers
  // every one of those without this route needing to know which.
  if (!assistant) notFound();

  const branding: Branding = (await loadBranding(assistant.account_id, publicId)) ?? UNBRANDED;

  const single = (key: string): string | undefined => {
    const value = query[key];
    return typeof value === "string" ? value : undefined;
  };

  const locale = normalizeLocale(single("locale"), assistant.locale_default);
  const embed = single("embed") === "1";
  const page = single("page") ?? null;

  // `transparent` mirrors `form.theme.transparentBackground`'s role on `/f`,
  // but there is no per-assistant setting for it: an embedded widget is
  // ALWAYS a floating launcher/panel over a host page it does not own the
  // backdrop of, and a direct visit is ALWAYS a full page the assistant
  // paints itself — the same two shapes, decided by `embed` rather than by
  // an operator toggle.
  const { style, darkCss, themed } = publicFormTheme(branding, embed, parseHostMode(single("theme")));

  return (
    <main
      className="bis-assistant-page"
      style={style}
      data-embedded={embed ? "" : undefined}
      {...(themed ? { "data-tenant-theme": "" } : {})}
    >
      {darkCss ? <style>{darkCss}</style> : null}
      <AssistantWidget
        publicId={publicId}
        embedded={embed}
        locale={locale}
        page={page}
        token={issueRenderToken(publicId)}
        name={assistant.name}
        greeting={assistant.greeting[locale] ?? null}
        suggestions={(assistant.suggestions[locale] ?? []).slice(0, 3)}
        brandLogoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
        strings={assistantStrings(locale)}
      />
    </main>
  );
}
