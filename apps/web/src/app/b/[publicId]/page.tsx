import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { serviceDb, brandLogoUrl, brandDisplayName, type Branding } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { partsInZone } from "@/lib/booking/slots";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { normalizeLocale, publicTabTitle } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
import { BookingPage } from "./booking-page";
import { getSlotsAction, submitBookingAction } from "./actions";
import {
  loadCalendar, loadCalendarSafe, isCalendarLive, loadCalendarBranding as loadBranding, UNBRANDED,
} from "./data";

export const dynamic = "force-dynamic";

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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Same reasoning as `f/[publicId]/page.tsx`: a booking calendar is reachable
// only by knowing its opaque publicId, and this URL is never meant to be a
// discoverable destination.
//
// The title (F-102, defect :870) is set only for the live case; a disabled
// or unknown calendar falls through to `app/b/[publicId]/layout.tsx`'s own
// brand-aware fallback (F-102 review round, fix 6) — not all the way to the
// ROOT `app/b/layout.tsx`'s static "Booking", which is now the last resort
// only if the segment layout's own read also fails.
//
// Uses `loadCalendarSafe`, NOT the page component's own `loadCalendar`
// below (F-102 review round, fix 1) — see `app/f/[publicId]/page.tsx`'s
// identical comment: `generateMetadata` has no `error.tsx` boundary to
// land in.
export async function generateMetadata(
  { params, searchParams }: {
    params: Promise<{ publicId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { publicId } = await params;
  const calendar = await loadCalendarSafe(publicId);
  if (!calendar || !isCalendarLive(calendar)) return { robots };
  const branding = await loadBranding(calendar.account_id, publicId);
  const query = await searchParams;
  const locale = normalizeLocale(typeof query.locale === "string" ? query.locale : undefined, "en");
  return {
    robots,
    title: publicTabTitle(bookingStrings(locale), brandDisplayName(branding ?? UNBRANDED)),
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
  // all the same HTTP STATUS (404) — `getCalendarByPublicId` deliberately
  // leaves `enabled` for this caller to check (via `isCalendarLive`, so
  // `app/b/[publicId]/layout.tsx` can apply the identical check against the
  // SAME cached row), the same split `getPublishedFormByPublicId` draws for
  // `status`. Status parity is not look parity — see that function's doc.
  if (!calendar || !isCalendarLive(calendar)) notFound();

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
    // `lang` on this element, not only on `<html>` (F-102 review round, fix
    // 7): `app/b/layout.tsx`'s `<html lang>` is always "en" (no per-document
    // default exists to read — see that file's comment), but THIS element
    // carries the locale actually resolved at render time, including a
    // `?locale=es` override `<html lang>` can never see. That is the first
    // server HTML, not a client patch: screen readers and translation tools
    // that respect the nearest `lang` ancestor read this one correctly even
    // when the document-level default disagrees.
    <main lang={locale} className="bis-booking-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
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
