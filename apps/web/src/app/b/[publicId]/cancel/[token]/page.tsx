import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  serviceDb, getBranding, brandLogoUrl, type Branding,
} from "@bis/db";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import { safeZone, formatWhen } from "../../actions";
import { lookupBookingByToken, confirmCancelAction } from "./actions";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

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
  const row = await lookupBookingByToken(serviceDb(), token);
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

/**
 * An inline Server Action (the `"use server"` directive as its own first
 * statement is what makes this legal in a Server Component file that is not
 * itself `"use server"`), rather than passing `confirmCancelAction` to the
 * form directly. `<form action>` requires a function returning
 * `void | Promise<void>`; `confirmCancelAction` returns `CancelResult` for
 * `actions.test.ts` to assert against. This is the thin adapter between the
 * two shapes, not a second copy of the mutation.
 */
async function submitCancel(publicId: string, token: string): Promise<void> {
  "use server";
  await confirmCancelAction(publicId, token);
}

export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ publicId: string; token: string }>;
}) {
  const { publicId, token } = await params;

  // `lookupBookingByToken` is a plain SELECT (see its own doc comment) — this
  // is what lets the four states below (unknown / cancelled / booked / past)
  // be told apart on a GET, unlike the accessor the form action below calls,
  // which deliberately collapses "unknown" and "already cancelled" into one
  // `null` for its own (idempotent-cancel) purpose. THIS module never calls
  // that mutating accessor at all — see `actions.test.ts`'s structural test.
  const row = await lookupBookingByToken(serviceDb(), token);
  if (!row) notFound();

  const branding = (await loadBranding(row.account_id, publicId, token)) ?? UNBRANDED;
  const timezone = await loadTimezone(row.account_id);
  const { style, darkCss, themed } = publicFormTheme(branding, false);

  const bookerZone = safeZone(row.booker_timezone ?? undefined, timezone);
  const when = formatWhen(new Date(row.starts_at), bookerZone);

  const isCancelled = row.status === "cancelled";
  const isPast = row.status === "completed" || row.status === "no_show";

  return (
    <main className="bis-cancel-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{CANCEL_CSS}</style>
      {(branding.brandName || branding.brandLogoPath) ? (
        <div className="bis-cancel-brand">
          {branding.brandLogoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogoUrl(branding.brandLogoPath)} alt="" className="bis-cancel-brand-logo" />
          ) : null}
          {branding.brandName ? <span className="bis-cancel-brand-name">{branding.brandName}</span> : null}
        </div>
      ) : null}

      <div className="bis-cancel">
        <p className="bis-cancel-when">{when}</p>

        {isCancelled ? (
          <p role="status" className="bis-cancel-title">{m["booking.cancel.alreadyCancelledTitle"]}</p>
        ) : isPast ? (
          <p role="status" className="bis-cancel-title">{m["booking.cancel.pastTitle"]}</p>
        ) : (
          <>
            <p className="bis-cancel-title">{m["booking.cancel.confirmTitle"]}</p>
            {/* A plain server-action form, no client component: React/Next
                progressively enhance this into a fetch-based submit, and
                without JS it still posts and re-renders this same server
                component — which is enough, because a successful cancel just
                means `row.status` reads "cancelled" on the very next render,
                landing this visitor on the `isCancelled` branch above with no
                separate "success" state to keep in sync with it. */}
            <form action={submitCancel.bind(null, publicId, token)}>
              <button type="submit" className="bis-cancel-submit">
                {m["booking.cancel.confirmButton"]}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

// Same `var(--token, <fallback>)` convention as `booking-page.tsx`'s own
// embedded stylesheet, for the same reason: an unthemed account renders
// exactly these fallbacks, a themed one inherits the tokens `publicFormTheme`
// already put on `<main>` above.
const CANCEL_CSS = `
.bis-cancel-page { background: var(--background, transparent); min-height: 100vh; }
.bis-cancel-brand { display: flex; align-items: center; gap: 8px; padding: 16px 16px 0; }
.bis-cancel-brand-logo { width: 28px; height: 28px; object-fit: contain; }
.bis-cancel-brand-name { font: 600 15px var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif); color: var(--foreground, #18181b); }
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
`;
