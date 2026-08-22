import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  serviceDb, getCalendarByPublicId, getBranding, brandLogoUrl, type Branding,
} from "@bis/db";
import { signRenderToken } from "@/lib/forms/guards";
import { partsInZone } from "@/lib/booking/slots";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
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
 *  reckoned in — lives on `accounts` and needs its own read. Defaults to
 *  UTC on any failure rather than 404ing a bookable calendar over a decorative
 *  (well, load-bearing-but-recoverable) read: a wrong-but-present zone is
 *  still bookable, just mislabeled, and `submitBookingAction` re-derives the
 *  authoritative zone itself at submit time regardless of what this page showed. */
const loadTimezone = cache(async (accountId: string): Promise<string> => {
  try {
    const { data } = await serviceDb().from("accounts").select("timezone").eq("id", accountId).maybeSingle();
    return (data as { timezone?: string } | null)?.timezone ?? "UTC";
  } catch {
    return "UTC";
  }
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
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const calendar = await loadCalendar(publicId);
  // A disabled calendar, an archived one and a token that never existed are
  // all the same 404 — `getCalendarByPublicId` deliberately leaves `enabled`
  // for this caller to check, the same split `getPublishedFormByPublicId`
  // draws for `status`.
  if (!calendar || !calendar.enabled) notFound();

  const branding: Branding = (await loadBranding(calendar.account_id, publicId)) ?? UNBRANDED;
  const timezone = await loadTimezone(calendar.account_id);

  const { style, darkCss, themed } = publicFormTheme(branding, false);

  const today = partsInZone(new Date(), timezone);
  const todayKey = `${today.y}-${pad(today.m)}-${pad(today.d)}`;

  return (
    <main className="bis-booking-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      {(branding.brandName || branding.brandLogoPath) ? (
        <div className="bis-booking-brand">
          {branding.brandLogoPath ? (
            // Decorative: the name beside it (when present) already carries the
            // meaning; when there is no name either, there is nothing honest to
            // caption an unfamiliar logo with.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogoUrl(branding.brandLogoPath)} alt="" className="bis-booking-brand-logo" />
          ) : null}
          {branding.brandName ? <span className="bis-booking-brand-name">{branding.brandName}</span> : null}
        </div>
      ) : null}
      <BookingPage
        todayKey={todayKey}
        maxAdvanceDays={calendar.max_advance_days}
        renderToken={issueRenderToken(publicId)}
        getSlots={getSlotsAction.bind(null, publicId)}
        submit={submitBookingAction.bind(null, publicId)}
      />
    </main>
  );
}
