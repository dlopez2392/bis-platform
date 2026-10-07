import type { Metadata } from "next";
import { serviceDb, getBranding, brandLogoUrl, type Branding } from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { readUnsubscribeToken, emailStateOf, pageStateOf } from "@/lib/consent/unsubscribe";
import type { UnsubscribeState } from "@/lib/consent/unsubscribe-copy";
import { UnsubscribeForm } from "./unsubscribe-form";
import "@/styles/public-brand.css";

export const dynamic = "force-dynamic";

/** Never indexed, and no Referer carries the token to the logo's host. */
export const metadata: Metadata = {
  title: m["unsubscribe.pageTitle"],
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

/**
 * `/u/<token>` — the link in every customer email's footer (spec §4.3, §6).
 * A GET only READS (decision Q1): a mail scanner that fetches the link
 * records nothing (plan R4, A5); the customer's own press records the stop
 * (unsubscribeAction). It opens on the question unless the customer's OWN
 * stop already stands (pageStateOf; decision Q5, review R1-I1). Branded with the client's logo and colour (DESIGN.md
 * rule 9), server-rendered, so there is no loading state. Never logs the token.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = readUnsubscribeToken(token);
  let branding: Branding | null = null;
  let initial: UnsubscribeState;
  if (!read.ok) {
    initial = read.why === "bad_token" ? "bad_link" : "failed";
  } else {
    const db = serviceDb();
    try {
      branding = await getBranding(db, read.payload.a);
    } catch (e) {
      // Decorative: a branding blip never costs a customer the way out.
      console.error(`unsubscribe page: branding unreadable for account ${read.payload.a}: ${loggableError(e)}`);
    }
    try {
      initial = pageStateOf(await emailStateOf(db, read.payload));
    } catch (e) {
      console.error(`unsubscribe page: consent state unreadable for account ${read.payload.a}: ${loggableError(e)}`);
      initial = "failed";
    }
  }
  const { style, darkCss, themed } = publicFormTheme(branding ?? UNBRANDED, false, parseHostMode(undefined));
  return (
    <main className="bis-unsub-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{UNSUB_CSS}</style>
      <PublicBrand
        name={branding?.brandName ?? null}
        logoUrl={branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      <div className="bis-unsub">
        <UnsubscribeForm token={token} initial={initial} brandName={branding?.brandName ?? null} />
        <p className="bis-unsub-poweredby">
          <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">{m["unsubscribe.poweredBy"]}</a>
        </p>
      </div>
    </main>
  );
}

// The cancel page's convention (its CANCEL_CSS): `var(--token, fallback)`, so
// an unthemed account renders exactly these fallbacks and a themed one the
// tokens publicFormTheme put on <main>. No backticks inside this literal.
const UNSUB_CSS = `
.bis-unsub-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
.bis-unsub {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 480px; margin: 0 auto;
}
.bis-unsub-section:focus { outline: none; }
.bis-unsub-lang + .bis-unsub-lang { margin-top: 16px; }
.bis-unsub-title { font-size: 17px; font-weight: 600; margin: 0 0 4px; }
.bis-unsub-detail { color: var(--muted-foreground, #71717a); margin: 0; }
.bis-unsub-actions { margin: 20px 0 0; }
.bis-unsub-primary, .bis-unsub-ghost {
  font: inherit; font-weight: 600; border-radius: var(--radius, 0.5rem); padding: 10px 18px; cursor: pointer;
}
.bis-unsub-primary { border: none; background: var(--form-accent, #6d28d9); color: var(--form-accent-foreground, #ffffff); }
.bis-unsub-ghost { border: 1px solid var(--border, #e4e4e7); background: transparent; color: var(--foreground, #18181b); }
.bis-unsub-primary:disabled, .bis-unsub-ghost:disabled { opacity: 0.6; cursor: not-allowed; }
.bis-unsub-primary:focus-visible, .bis-unsub-ghost:focus-visible { outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 2px; }
.bis-unsub-poweredby { margin: 24px 0 0; font-size: 12px; text-align: center; }
.bis-unsub-poweredby a { color: var(--muted-foreground, #71717a); text-decoration: none; }
.bis-unsub-poweredby a:hover { text-decoration: underline; }
`;
