import type { Metadata } from "next";
import { brandDisplayName, type Branding } from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { loadPage, loadPageSafe } from "./data";
import { CustomerUploadList } from "./customer-upload-list";
import { DOCREQ_CSS } from "./docreq-css";
import { docCopy } from "./copy";
import "@/styles/public-brand.css";

export const dynamic = "force-dynamic";

/** Never indexed, and no Referer carries the token to the logo's host; the title in the request's language. */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const page = await loadPageSafe(token);
  return {
    title: t(m, "customerDocs.pageTitle", page?.language ?? "en"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

const DEAD_END: Record<"expired" | "revoked" | "not_found", MessageKey> = {
  expired: "customerDocs.expired", revoked: "customerDocs.revoked", not_found: "customerDocs.notFound",
};

/**
 * `/d/<token>` (S-07 2b, spec 4.3): the customer's page for one document request. No sign-in: the token
 * is the proof, checked by `customerPage` before anything else is read. On the client's brand (rule 9:
 * logo, colour, "Powered by BIS"), in the REQUEST's language, server-rendered and re-read by
 * `router.refresh()` while a file is Checking. Each file is a dot and a word, never its name, size or a
 * link: nothing stored is ever shown back. A failed read throws to `error.tsx`.
 */
export default async function CustomerDocsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await loadPage(token);
  const lang = page.language;
  // The brand name, or null when the account has none: then every sentence that would name the business
  // is its own no-name wording (docCopy), never "the business"/"el negocio" dropped into the {business} hole.
  const business = (page.branding && brandDisplayName(page.branding)) || null;
  const tt = docCopy(lang, business);
  const { style, darkCss, themed } = publicFormTheme(page.branding ?? UNBRANDED, false, parseHostMode(undefined));

  let body: React.ReactNode;
  if (page.state === "open") {
    body = (
      <>
        <h1 className="bis-docreq-title">{tt("customerDocs.heading")}</h1>
        <p className="bis-docreq-detail">{tt("customerDocs.intro")}</p>
        {/* Only what the list needs crosses to the browser: never the Branding (it carries replyToEmail). */}
        <CustomerUploadList token={token} locale={lang} business={business} items={page.items} />
      </>
    );
  } else if (page.state === "completed") {
    body = <h1 className="bis-docreq-title">{tt("customerDocs.done")}</h1>;
  } else {
    body = (
      <>
        <h1 className="bis-docreq-title">{tt(DEAD_END[page.state])}</h1>
        <p className="bis-docreq-detail">{tt("customerDocs.ask")}</p>
      </>
    );
  }

  return (
    <main className="bis-docreq-page" lang={lang} style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{DOCREQ_CSS}</style>
      <PublicBrand name={business} logoUrl={page.logoUrl} />
      <div className="bis-docreq">
        {body}
        {page.state === "not_found" ? null : (
          <p className="bis-docreq-call">
            {page.phone ? tt("customerDocs.call", { phone: page.phone }) : tt("customerDocs.callNoPhone")}
          </p>
        )}
        <p className="bis-docreq-poweredby">
          <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">{tt("customerDocs.poweredBy")}</a>
        </p>
      </div>
    </main>
  );
}
