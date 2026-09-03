import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  serviceDb, getBranding, brandLogoUrl, type Branding,
} from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
import { lookupBookingByToken } from "./actions";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";

/**
 * MINOR fix: `generateMetadata` and the page component below both run
 * against the SAME request and both need this exact row — same double-fetch
 * shape, and the same `cache()` fix, `b/[publicId]/page.tsx`'s own
 * `loadCalendar` already applies. One query, not two, on a route that is
 * anonymous, `force-dynamic`, and reachable by anyone holding the link.
 */
const loadBooking = cache((token: string) => lookupBookingByToken(serviceDb(), token));

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

/** Same fallback reasoning as the sibling booking page's `loadBranding`: a
 *  database blip on this decorative read must never cost a visitor their
 *  ability to cancel. */
async function loadBranding(accountId: string, publicId: string, token: string): Promise<Branding | null> {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`cancel ${publicId}/${token}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
}

/** The account's own zone, for the fallback `safeZone` needs — same shape as
 *  the sibling page's `loadTimezone`, narrowed to the one column this route
 *  needs. THROWS on a query error rather than defaulting to UTC, for the
 *  identical reason: a wrong-but-silent zone is worse here than the generic
 *  error `error.tsx` already renders for this segment. */
async function loadTimezone(accountId: string): Promise<string> {
  const { data, error } = await serviceDb().from("accounts")
    .select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`cancel page: account timezone read failed for ${accountId}: ${error.message}`);
  return (data as { timezone?: string } | null)?.timezone ?? "UTC";
}

// Same reasoning as the sibling booking page: reachable only by an opaque
// token in an email link, never a discoverable destination.
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string; token: string }> },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId, token } = await params;
  const row = await loadBooking(token);
  if (!row) return { robots };
  const branding = await loadBranding(row.account_id, publicId, token);
  return {
    robots,
    ...(branding?.brandLogoPath ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } } : {}),
  };
}

/**
 * `/b/<publicId>/cancel/<token>` — reached from the link every confirmation
 * and reminder email carries. This component is a pure GET-time READ: the
 * only write in this whole route tree lives in `confirmCancelAction`
 * (`actions.ts`), fired by the form below on a real POST. That split is not
 * incidental — an email client or security scanner that prefetches links to
 * check them for malware issues a GET against this exact URL before any
 * human ever opens the message, and a cancel-on-GET design would let that
 * prefetch silently cancel a booking nobody asked to cancel.
 */

export default async function CancelBookingPage({
  params, searchParams,
}: {
  params: Promise<{ publicId: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId, token } = await params;
  // The confirmation email links here with `?locale=es` for a Spanish
  // booker; the same fallback as the booking page — English for anything
  // absent or unknown.
  const query = await searchParams;
  const locale = normalizeLocale(typeof query.locale === "string" ? query.locale : undefined, "en");
  const strings = bookingStrings(locale);

  // `lookupBookingByToken` (via the `loadBooking` cache wrapper above) is a
  // plain SELECT — this is what lets the four states below (unknown /
  // cancelled / booked / past) be told apart on a GET, unlike the accessor
  // `CancelForm`'s submit calls, which deliberately collapses "unknown" and
  // "already cancelled" into one `null` for its own (idempotent-cancel)
  // purpose. THIS module never calls that mutating accessor at all — see
  // `actions.test.ts`'s structural test.
  const row = await loadBooking(token);
  if (!row) notFound();

  const branding = (await loadBranding(row.account_id, publicId, token)) ?? UNBRANDED;
  const timezone = await loadTimezone(row.account_id);
  // The third argument the booking page has had since PR #22 and this page did
  // not: a host site rendering this in an iframe names its own colour mode with
  // ?theme=, and the cancel page is the second page of that same flow — so a
  // dark host embedded a light cancel page. Same `typeof` guard as ?locale=
  // above, rather than the booking page's looser cast.
  const { style, darkCss, themed } = publicFormTheme(
    branding, false, parseHostMode(typeof query.theme === "string" ? query.theme : undefined),
  );

  const bookerZone = safeZone(row.booker_timezone ?? undefined, timezone);
  const when = formatWhen(new Date(row.starts_at), bookerZone, locale);

  const isCancelled = row.status === "cancelled";
  const isPast = row.status === "completed" || row.status === "no_show";

  return (
    <main className="bis-cancel-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{CANCEL_CSS}</style>
      <PublicBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />

      <div className="bis-cancel">
        <p className="bis-cancel-when">{when}</p>

        {isCancelled ? (
          <p role="status" className="bis-cancel-title">{strings.cancelAlreadyCancelledTitle}</p>
        ) : isPast ? (
          <p role="status" className="bis-cancel-title">{strings.cancelPastTitle}</p>
        ) : (
          // `CancelForm` is the one client component on this route: the
          // GET-time state above (cancelled / past / unknown-via-notFound)
          // stays server-rendered, but a failed submit needs somewhere to
          // hold and show `CancelResult.error` — the plain server-action
          // form this replaced discarded that result entirely, which is
          // exactly the "a failed cancel is silent" bug this fixes.
          <CancelForm publicId={publicId} token={token} locale={locale} strings={strings} />
        )}

        {/* Same treatment and the same new-tab reasoning as the booking page's
            own footer — this is the second page of that one flow. */}
        <p className="bis-cancel-poweredby">
          <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">
            {strings.poweredBy}
          </a>
        </p>
      </div>
    </main>
  );
}

// Same `var(--token, <fallback>)` convention as `booking-page.tsx`'s own
// embedded stylesheet, for the same reason: an unthemed account renders
// exactly these fallbacks, a themed one inherits the tokens `publicFormTheme`
// already put on `<main>` above.
const CANCEL_CSS = `
/* --public-measure: this page's own column width, read by the shared brand
   header (styles/public-brand.css). Same sibling-not-child reasoning as the
   booking page's own rule — see booking-page.tsx. */
.bis-cancel-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
.bis-cancel {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 480px; margin: 0 auto;
}
.bis-cancel-when { color: var(--muted-foreground, #71717a); margin: 0 0 4px; }
.bis-cancel-title { font-size: 17px; font-weight: 600; margin: 0 0 16px; }
.bis-cancel-submit {
  font: 600 15px inherit; border: none; border-radius: var(--radius, 0.5rem);
  background: var(--form-accent, #6d28d9); color: var(--form-accent-foreground, #ffffff);
  padding: 10px 18px; cursor: pointer;
}
.bis-cancel-submit:disabled { opacity: 0.6; cursor: not-allowed; }
/* Same AA reasoning as the booking page's own error rule — see booking-page.tsx. */
.bis-cancel-error { color: var(--form-error, #b91c1c); margin: 12px 0 0; }
.bis-cancel-poweredby { margin: 24px 0 0; font-size: 12px; text-align: center; }
.bis-cancel-poweredby a { color: var(--muted-foreground, #71717a); text-decoration: none; }
.bis-cancel-poweredby a:hover { text-decoration: underline; }
`;
