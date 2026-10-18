import type { Metadata } from "next";
import { brandDisplayName, type Branding } from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import type { MessageKey } from "@/lib/messages";
import type { SharePage, ShareState } from "@/lib/document-shares/public-share";
import { DOCREQ_CSS } from "../../d/[token]/docreq-css";
import { loadPage, loadPageSafe } from "./data";
import { shareCopy } from "./copy";
import { ShareDownload } from "./share-download";
import "@/styles/public-brand.css";

export const dynamic = "force-dynamic";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

const REFUSAL: Record<Exclude<ShareState, "open">, MessageKey> = {
  // Review F10: expired and not-found are 2b's own sentences (customerDocs.*), shared by both customer pages.
  expired: "customerDocs.expired", revoked: "sharePage.revoked", trashed: "sharePage.trashed",
  removed: "sharePage.removed", not_found: "customerDocs.notFound",
};

/**
 * The business a page may name: the brand name, or null. An unknown or malformed token names NO
 * business whatever the read carried (spec 4.2, plan deviation 6): sharePage already answers nothing
 * for it, and the page does not lean on that.
 */
function businessOf(page: SharePage | null): string | null {
  if (!page || page.state === "not_found") return null;
  return (page.branding && brandDisplayName(page.branding)) || null;
}

/** Never indexed, no Referer on; the title in the account's language (spec 4.2; plan deviation 7). */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const page = await loadPageSafe(token);
  return {
    title: shareCopy(page?.language ?? "en", businessOf(page))("sharePage.pageTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * `/s/<token>` (S-07 3b, spec 4.2): a shared file's page. No sign-in: the token is the proof, checked
 * by sharePage before anything else is read. On the client's brand (rule 9: logo, colour, "Powered by
 * BIS"), in the ACCOUNT's language. Open: the title, its type and size, one Download, nothing else about
 * the customer. Refused: its own sentence, the ask and the call line naming the business. Not found:
 * one sentence and no business at all. A failed read throws to error.tsx.
 */
export default async function SharedFilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await loadPage(token);
  const lang = page.language;
  const known = page.state !== "not_found";
  const business = businessOf(page);
  const tt = shareCopy(lang, business);
  const { style, darkCss, themed } = publicFormTheme((known && page.branding) || UNBRANDED, false, parseHostMode(undefined));

  const body = page.state === "open" && page.file ? (
    <>
      <h1 className="bis-docreq-title" data-share-state="open">{tt("sharePage.heading")}</h1>
      {/* The customer's own words: their language is not the page's. */}
      <p className="bis-docreq-label" lang="">{page.file.title}</p>
      <p className="bis-docreq-detail" data-share-file>{tt("sharePage.details", { type: page.file.type, size: page.file.size })}</p>
      <ShareDownload token={token} label={tt("sharePage.download")} limitText={tt("sharePage.limit")} failedText={tt("sharePage.failed")} />
    </>
  ) : (
    <>
      <h1 className="bis-docreq-title" data-share-state={page.state}>
        {tt(page.state === "open" ? "customerDocs.notFound" : REFUSAL[page.state])}
      </h1>
      {known ? <p className="bis-docreq-detail">{tt("sharePage.ask")}</p> : null}
    </>
  );

  return (
    <main className="bis-docreq-page" lang={lang} style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{DOCREQ_CSS}</style>
      {known ? <PublicBrand name={business} logoUrl={page.logoUrl} /> : null}
      <div className="bis-docreq">
        {body}
        {known ? (
          <p className="bis-docreq-call">
            {page.phone ? tt("customerDocs.call", { phone: page.phone }) : tt("customerDocs.callNoPhone")}
          </p>
        ) : null}
        <p className="bis-docreq-poweredby">
          <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">{tt("customerDocs.poweredBy")}</a>
        </p>
      </div>
    </main>
  );
}
