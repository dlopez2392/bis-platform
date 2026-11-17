import type { Metadata } from "next";
import { serviceDb, brandDisplayName, brandLogoUrl, CHECKIN_ANSWERS, type Branding } from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { readCheckinToken } from "@/lib/checkin/token";
import { loadCheckinPage } from "@/lib/checkin/flow";
import { answerKey, checkinCopy, stackedLines, stackedTitle, thankYouKey } from "@/lib/checkin/copy";
import { answerCheckinAction, reviewLinkAction } from "./actions";
import { Message, ReviewButton, StackedMessage, ThankYou } from "./checkin-views";
import { CHECKIN_CSS } from "./checkin-css";
import "@/styles/public-brand.css";

export const dynamic = "force-dynamic";

/** Never indexed, and no Referer carries the token to the logo's host. The title is in the token's language once
 *  the token verifies (no database read: the language is inside the signature), and in both before that. */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const read = readCheckinToken(token);
  return {
    title: read.ok ? t(m, "checkin.pageTitle", read.payload.l) : stackedTitle("checkin.pageTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

/**
 * `/r/<token>` (F-072, plan D1): the customer's page after a job, reached from the check-in email with no sign-in;
 * the signed token is the proof. A GET only READS: the booking is re-read by (the token's account, the token's
 * booking) and must be completed, and nothing is written here, so a mail scanner that fetches the link records
 * nothing. The customer's own press writes (answerCheckinAction). Branded with the client's logo and colour
 * (DESIGN.md rule 9), in the language the email was sent in, server-rendered, so there is no loading state. A
 * failed read throws to error.tsx. Never logs or prints the token.
 *
 * After ANY answer the same thank-you block follows, with the same review button, built by one component that is
 * never told the answer: only the sentence above it differs. Nothing before the answer mentions a review.
 */
export default async function CheckinPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const { retry } = await searchParams;
  const read = readCheckinToken(token);

  // No language to trust and no account to brand: both languages stacked, and not one query.
  if (!read.ok) {
    const key = read.why === "not_configured" ? "checkin.unavailable" : "checkin.notValid";
    const title = stackedLines(`${key}.title`);
    const detail = stackedLines(`${key}.detail`);
    return (
      <Frame style={undefined} themed={false} darkCss={undefined} brand={null} powered={stackedLines("checkin.poweredBy")}>
        <StackedMessage en={{ title: title.en, detail: detail.en }} es={{ title: title.es, detail: detail.es }} />
      </Frame>
    );
  }

  const lang = read.payload.l;
  const page = await loadCheckinPage(serviceDb(), read.payload, new Date());
  const business = (page.branding && brandDisplayName(page.branding)) || null;
  const tt = checkinCopy(lang, business);
  const { style, darkCss, themed } = publicFormTheme(page.branding ?? UNBRANDED, false, parseHostMode(undefined));
  const answerAction = answerCheckinAction.bind(null, token);
  // ONE expression, shared by every answer: nothing below decides per answer whether it is shown.
  const review = page.reviewUrl
    ? <ReviewButton action={reviewLinkAction.bind(null, token)} label={tt("checkin.review.button")} />
    : null;

  let body: React.ReactNode;
  const view = page.view;
  if (view.kind === "not_valid") {
    body = <Message title={tt("checkin.notValid.title")} detail={tt("checkin.notValid.detail")} />;
  } else if (view.kind === "answered") {
    body = (
      <ThankYou
        yourAnswer={tt("checkin.yourAnswer", { answer: tt(answerKey(view.answer)) })}
        sentence={tt(thankYouKey(view.answer, page.reviewUrl !== null))}
      >
        {review}
      </ThankYou>
    );
  } else if (view.kind === "expired") {
    body = (
      <>
        <h1 className="bis-checkin-title">{tt("checkin.expired.title")}</h1>
        {page.reviewUrl ? <p className="bis-checkin-sentence">{tt("checkin.expired.body")}</p> : null}
        {review}
      </>
    );
  } else {
    body = (
      <>
        <h1 className="bis-checkin-title">{tt("checkin.ask.title")}</h1>
        <p className="bis-checkin-detail">{tt("checkin.ask.detail")}</p>
        {retry === "1" ? (
          <div role="alert" className="bis-checkin-alert">
            <p className="bis-checkin-title">{tt("checkin.retry.title")}</p>
            <p className="bis-checkin-detail">{tt("checkin.retry.detail")}</p>
          </div>
        ) : null}
        <form action={answerAction} className="bis-checkin-tiles">
          {CHECKIN_ANSWERS.map((a) => (
            <button key={a} type="submit" name="answer" value={a} className="bis-checkin-tile">{tt(answerKey(a))}</button>
          ))}
        </form>
      </>
    );
  }

  return (
    <Frame
      lang={lang} style={style} themed={themed} darkCss={darkCss}
      brand={{ name: business, logoUrl: page.branding?.brandLogoPath ? brandLogoUrl(page.branding.brandLogoPath) : null }}
      powered={{ en: tt("checkin.poweredBy"), es: null }}
    >
      {body}
    </Frame>
  );
}

function Frame({ lang, style, themed, darkCss, brand, powered, children }: {
  lang?: "en" | "es"; style: React.CSSProperties | undefined; themed: boolean; darkCss: string | null | undefined;
  brand: { name: string | null; logoUrl: string | null } | null;
  /** The footer's words: one language, or both stacked on a page with none. */
  powered: { en: string; es: string | null }; children: React.ReactNode;
}) {
  return (
    <main className="bis-checkin-page" {...(lang ? { lang } : {})} style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{CHECKIN_CSS}</style>
      {brand ? <PublicBrand name={brand.name} logoUrl={brand.logoUrl} /> : null}
      <div className="bis-checkin">
        {children}
        <p className="bis-checkin-poweredby">
          <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">
            {powered.es ? `${powered.en} / ${powered.es}` : powered.en}
          </a>
        </p>
      </div>
    </main>
  );
}
