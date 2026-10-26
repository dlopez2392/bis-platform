import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { billingEnforced } from "./enforce";
import { billingVerdictFor } from "./standing-read";

/** Next 16.3.6's server-action request header (app-router-headers.js:96). A
 *  redirect that follows an action drops it (action-handler.js deletes
 *  ACTION_HEADER before fetching the target), so the page this sends the
 *  browser to renders as a plain RSC request and is never refused in turn. */
export const ACTION_HEADER = "next-action";

/**
 * Is this request a server action? Next 16.3.6 treats a POST as one when it
 * carries `next-action` (the client's fetch) OR when its body is a form,
 * multipart or url-encoded, with no header at all (a no-JS form post;
 * server-action-request-meta.js, isMultipartAction / isURLEncodedAction).
 * The second kind is answered with a plain 303, after its write has run,
 * unless it is refused here first. `rsc` excludes the render Next forwards
 * after an action's redirect: that fetch drops `next-action` but keeps the
 * original content-type, and sends `rsc: 1`; a browser's own form post never
 * does. (`headers()` has no method; a GET carrying a form content-type is
 * refused too, which only redirects.)
 */
export function isActionRequest(h: Headers): boolean {
  if (h.get(ACTION_HEADER) !== null) return true;
  if (h.get("rsc") !== null) return false;
  const type = (h.get("content-type") ?? "").toLowerCase();
  return type.startsWith("multipart/form-data") || type.startsWith("application/x-www-form-urlencoded");
}

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
 * for a CLIENT caller only. Refuses a SERVER ACTION (isActionRequest: the
 * `next-action` header, or a form post; a page render, a layout and a GET
 * carry neither) on a paused account by sending the browser back to the page
 * it came from, where the paused banner says why. Nothing is written. Switch off: returns at once,
 * reading nothing. A failed read: allowed (billingVerdictFor fails open).
 */
export async function refuseActionWhilePaused(accountId: string, fallback: string): Promise<void> {
  if (!billingEnforced()) return;
  const h = await headers();
  if (!isActionRequest(h)) return;
  if (!(await billingVerdictFor(accountId)).paused) return;
  console.log(`read-only: refused a client action on paused account ${accountId}`);
  redirect(sameAccountPath(h.get("referer"), accountId) ?? fallback);
}
