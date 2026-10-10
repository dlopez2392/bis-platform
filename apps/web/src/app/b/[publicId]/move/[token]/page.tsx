import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  serviceDb, getBranding, brandLogoUrl, brandDisplayName, bookingWasMoved, type Branding,
} from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { partsInZone } from "@/lib/booking/slots";
import { isBookingToken } from "@/lib/booking/links";
import { normalizeLocale, publicTabTitle } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
import { BOOKING_CSS } from "../../booking-css";
import { UNBRANDED } from "../../data";
import { loadMoveContext, loadMoveContextSafe, moveState, scrubToken, type MoveContext } from "./data";
import { getMoveSlotsAction, confirmMoveAction } from "./actions";
import { MoveForm } from "./move-form";

export const dynamic = "force-dynamic";

/**
 * `/b/<publicId>/move/<token>` — F-048 (rider): the customer moves their own
 * booking. Reached from the "Change the time" link in the confirmation and
 * the "moved" email, and from the cancel page. The cancel token is the
 * capability; a value that is not one 404s before any read, and no log line
 * carries it.
 *
 * A pure GET-time READ, like the cancel page: the only write is
 * `confirmMoveAction`, on a real POST from the form, so a mail scanner that
 * prefetches the link moves nothing.
 *
 * Everything is the ROW's (`readMoveContext`): the calendar, the account's
 * zone and brand. The URL's `publicId` must name that same calendar, or the
 * link is not this booking's and 404s.
 */

/** Same fallback reasoning as the cancel page: a blip on this decorative
 *  read must never cost a customer the page. */
async function loadBranding(accountId: string): Promise<Branding | null> {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`move page: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Whether a cancelled booking was replaced by a move, so its old link says
 *  "moved". A failed read falls back to the plain cancelled words. */
async function wasMoved(ctx: MoveContext): Promise<boolean> {
  try {
    return await bookingWasMoved(serviceDb(), ctx.row.account_id, ctx.row.id);
  } catch (e) {
    console.error(`move page: moved-check failed for booking ${ctx.row.id}: ${String(e)}`);
    return false;
  }
}

export async function generateMetadata(
  { params, searchParams }: {
    params: Promise<{ publicId: string; token: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { token } = await params;
  if (!isBookingToken(token)) return { robots };
  const ctx = await loadMoveContextSafe(token);
  if (!ctx) return { robots };
  const branding = await loadBranding(ctx.row.account_id);
  const query = await searchParams;
  const strings = bookingStrings(normalizeLocale(typeof query.locale === "string" ? query.locale : undefined, "en"));
  return {
    robots,
    title: publicTabTitle(
      { tabTitleWithBrand: strings.moveTabTitleWithBrand, tabTitleNoBrand: strings.moveTabTitleNoBrand },
      brandDisplayName(branding ?? UNBRANDED),
    ),
    ...(branding?.brandLogoPath ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } } : {}),
  };
}

export default async function MoveBookingPage({
  params, searchParams,
}: {
  params: Promise<{ publicId: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId, token } = await params;
  const query = await searchParams;
  const locale = normalizeLocale(typeof query.locale === "string" ? query.locale : undefined, "en");
  const strings = bookingStrings(locale);

  if (!isBookingToken(token)) notFound();
  let ctx: MoveContext | null;
  try {
    ctx = await loadMoveContext(token);
  } catch (e) {
    // Reaches `app/b/error.tsx`, the cancel page's path; the token is cut out
    // of whatever the read said first.
    throw new Error(`move page: booking read failed: ${scrubToken(e, token)}`);
  }
  if (!ctx || ctx.calendar.public_id !== publicId) notFound();

  const branding = (await loadBranding(ctx.row.account_id)) ?? UNBRANDED;
  const { style, darkCss, themed } = publicFormTheme(
    branding, false, parseHostMode(typeof query.theme === "string" ? query.theme : undefined),
  );
  const timezone = ctx.account.timezone ?? "UTC";
  const bookerZone = safeZone(ctx.row.booker_timezone ?? undefined, timezone);
  const when = formatWhen(new Date(ctx.row.starts_at), bookerZone, locale);
  const cancelHref = `/b/${publicId}/cancel/${token}${locale === "es" ? "?locale=es" : ""}`;

  const now = new Date();
  const state = moveState(ctx, now);
  const today = partsInZone(now, timezone);
  const todayKey = `${today.y}-${pad(today.m)}-${pad(today.d)}`;

  const poweredBy = (
    <p className="bis-booking-poweredby">
      <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">{strings.poweredBy}</a>
    </p>
  );

  let body;
  if (state === "live") {
    body = (
      <MoveForm
        locale={locale} strings={strings} currentWhen={when}
        todayKey={todayKey} maxAdvanceDays={ctx.calendar.max_advance_days}
        getSlots={getMoveSlotsAction.bind(null, token, locale)}
        submit={confirmMoveAction.bind(null, token, locale)}
        cancelHref={cancelHref}
      />
    );
  } else {
    const moved = state === "cancelled" && await wasMoved(ctx);
    const message = state === "cancelled"
      ? (moved ? strings.movedTitle : strings.cancelAlreadyCancelledTitle)
      : state === "past" ? strings.cancelPastTitle : strings.moveOffline; // offline, capped
    body = (
      <div className="bis-booking">
        <div className="bis-booking-current">
          <p className="bis-booking-chosen-label">{strings.moveCurrentLabel}</p>
          <p className="bis-booking-current-when">{when}</p>
        </div>
        <p role="status" className="bis-booking-status">{message}</p>
        {moved ? <p className="bis-booking-status-body">{strings.movedBody}</p> : null}
        {/* Switched off for changes, but the booking is still live: the
            cancel page beside this one is the other way out. */}
        {state === "offline" || state === "capped" ? (
          <p className="bis-booking-alt"><a href={cancelHref}>{strings.cancelInsteadLink}</a></p>
        ) : null}
        {poweredBy}
      </div>
    );
  }

  return (
    // `lang` on this element, the F-102 rule: `<html lang>` on this tree is
    // always "en", and this carries the `?locale=` the email's link set.
    <main lang={locale} className="bis-booking-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{BOOKING_CSS}</style>
      <PublicBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      {body}
    </main>
  );
}
