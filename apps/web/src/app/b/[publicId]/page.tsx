import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  serviceDb, getCalendarByPublicId, getBranding, brandLogoUrl, type Branding,
} from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { partsInZone } from "@/lib/booking/slots";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
import { BookingPage } from "./booking-page";
import { getSlotsAction, submitBookingAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Same `cache()` technique `f/[publicId]/page.tsx` uses and for the same
 * reason: `generateMetadata` and the component below run separately against
 * the SAME request, and both need this row. One query, not two, on a route
 * that is anonymous, `force-dynamic`, and reachable by any stranger who has
 * the link.
 */
const loadCalendar = cache((publicId: string) => getCalendarByPublicId(serviceDb(), publicId));

/** Null on failure, same reasoning as the sibling form page: without the
 *  calendar there is nothing to render, but without the branding there is
 *  still a bookable calendar. A database blip on the decorative read must
 *  never cost a company a booking. */
const loadBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`public booking ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

/** `getCalendarByPublicId` selects only the `calendars` row; the account's
 *  timezone — what the day strip and every when-string on this route are
 *  reckoned in — lives on `accounts` and needs its own read.
 *
 *  THROWS on a query error (I3) rather than falling back to UTC: this used to
 *  swallow the error and default the whole page's zone silently, on the
 *  reasoning that a wrong-but-present zone is still bookable, just mislabeled.
 *  That stopped being the safer choice once `app/b/error.tsx` (I5) existed —
 *  a generic error screen is a more honest outcome than quietly showing a
 *  09:00-17:00 business as bookable at 03:00 local with nothing on the page
 *  to say so. `submitBookingAction` still re-derives the authoritative zone
 *  itself at submit time regardless of what this page showed, but that is no
 *  longer a reason to hide a real read failure from the visitor. */
const loadTimezone = cache(async (accountId: string): Promise<string> => {
  const { data, error } = await serviceDb().from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`public booking: account timezone read failed for ${accountId}: ${error.message}`);
  return (data as { timezone?: string } | null)?.timezone ?? "UTC";
});

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Same reasoning as `f/[publicId]/page.tsx`: a booking calendar is reachable
// only by knowing its opaque publicId, and this URL is never meant to be a
// discoverable destination.
export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId } = await params;
  const calendar = await loadCalendar(publicId);
  if (!calendar || !calendar.enabled) return { robots };
  const branding = await loadBranding(calendar.account_id, publicId);
  return {
    robots,
    ...(branding?.brandLogoPath ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } } : {}),
  };
}

// A plain helper, not inline in the component body, for the same
// react-hooks/purity reason `f/[publicId]/page.tsx`'s `issueRenderToken`
// exists: this Server Component is `force-dynamic` specifically so it can
// mint a fresh, request-scoped token on every render.
function issueRenderToken(publicId: string): string {
  return signRenderToken(Date.now(), publicId);
}

export default async function PublicBookingPage({
  params, searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  const query = await searchParams;
  const calendar = await loadCalendar(publicId);
  // A disabled calendar, an archived one and a token that never existed are
  // all the same 404 — `getCalendarByPublicId` deliberately leaves `enabled`
  // for this caller to check, the same split `getPublishedFormByPublicId`
  // draws for `status`.
  if (!calendar || !calendar.enabled) notFound();

  const branding: Branding = (await loadBranding(calendar.account_id, publicId)) ?? UNBRANDED;
  const timezone = await loadTimezone(calendar.account_id);

  // `?theme=` is the host page naming its own colour mode (forwarded by
  // `embed.js` from `data-theme`); `?locale=` is the language `embed.js` has
  // forwarded from `data-locale` all along, and which this route ignored
  // until the first bilingual host embedded it. A calendar has no
  // `locale_default` of its own the way a form does, so English is the
  // fallback for an absent or unknown value.
  const { style, darkCss, themed } = publicFormTheme(branding, false, parseHostMode(query.theme as string | undefined));
  const locale = normalizeLocale(typeof query.locale === "string" ? query.locale : undefined, "en");

  // Same shape as `f/[publicId]/page.tsx`'s identical block: `embed.js`
  // lifts utm_*/gclid/fbclid off the HOST page (the iframe's own URL can
  // never see them) and forwards them here as query params. Re-encoded
  // through `parseAttribution` before it ever reaches the client, so the
  // hidden field this page hands `BookingPage` already carries only the
  // allow-listed keys, each already capped — `submitBookingAction` parses it
  // again at submit time regardless, but this is not the boundary that
  // guards anything; it just keeps a crafted query string from bloating a
  // hidden input.
  const flat = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") flat.set(key, value);
  }
  const attribution = new URLSearchParams(parseAttribution(flat)).toString();

  const today = partsInZone(new Date(), timezone);
  const todayKey = `${today.y}-${pad(today.m)}-${pad(today.d)}`;

  return (
    <main className="bis-booking-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <PublicBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      <BookingPage
        locale={locale}
        strings={bookingStrings(locale)}
        todayKey={todayKey}
        maxAdvanceDays={calendar.max_advance_days}
        renderToken={issueRenderToken(publicId)}
        attribution={attribution}
        getSlots={getSlotsAction.bind(null, publicId, locale)}
        submit={submitBookingAction.bind(null, publicId)}
      />
    </main>
  );
}
