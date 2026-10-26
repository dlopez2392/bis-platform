import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { billingEnforced } from "./enforce";
import { billingVerdictFor } from "./standing-read";

/** Next 16.3.6's server-action request header (app-router-headers.js:96). A
 *  redirect that follows an action drops it (action-handler.js deletes
 *  ACTION_HEADER before fetching the target), so the page this sends the
 *  browser to renders as a plain RSC request and is never refused in turn. */
export const ACTION_HEADER = "next-action";

/** The path of `referer` when it is inside THIS account, else null. Only the
 *  path is kept, so the redirect is always same-origin. */
export function sameAccountPath(referer: string | null, accountId: string): string | null {
  if (!referer) return null;
  let url: URL;
  try { url = new URL(referer); } catch { return null; }
  return url.pathname.startsWith(`/dashboard/accounts/${accountId}/`) ? url.pathname + url.search : null;
}

/**
 * "Dashboard read-only" (spec flow 5; plan G11). Called by requireAccountAccess
 * for a CLIENT caller only. Refuses a SERVER ACTION (the request carries
 * `next-action`; a page render, a layout and a GET never do) on a paused
 * account by sending the browser back to the page it came from, where the
 * paused banner says why. Nothing is written. Switch off: returns at once,
 * reading nothing. A failed read: allowed (billingVerdictFor fails open).
 */
export async function refuseActionWhilePaused(accountId: string, fallback: string): Promise<void> {
  if (!billingEnforced()) return;
  const h = await headers();
  if (h.get(ACTION_HEADER) === null) return;
  if (!(await billingVerdictFor(accountId)).paused) return;
  console.log(`read-only: refused a client action on paused account ${accountId}`);
  redirect(sameAccountPath(h.get("referer"), accountId) ?? fallback);
}
