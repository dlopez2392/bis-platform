"use server";

import { redirect } from "next/navigation";
import { serviceDb } from "@bis/db";
import { answerCheckin, reviewLinkTarget } from "@/lib/checkin/flow";
import { readCheckinToken } from "@/lib/checkin/token";

/**
 * The /r page's two presses (F-072, plan D1 to D3). Each RE-OPENS the token itself: the page's state is never
 * trusted, and a form body is never trusted for anything but WHICH of the three answers was pressed. The account
 * and booking come from the verified token alone (a smuggled bookingId or accountId field is never read), and the
 * contact is taken by the data layer from the booking's own row. Server actions are POST-only and refuse a foreign
 * Origin, so a page elsewhere cannot press them, and a mail scanner that only fetches the link presses nothing.
 *
 * A token that does not open (forged, or no secret configured) does nothing at all: no read, no write, and the
 * page itself says why when it is shown. `token` is safe to put in a path once it has verified: it is base64url
 * and dots, nothing else.
 */
export async function answerCheckinAction(token: string, formData: FormData): Promise<void> {
  const read = readCheckinToken(token);
  if (!read.ok) return;
  const outcome = await answerCheckin(serviceDb(), read.payload, formData.get("answer"), new Date());
  // The page re-reads and says what is true: the thank-you, or the designed "tap again".
  redirect(outcome === "retry" ? `/r/${token}?retry=1` : `/r/${token}`);
}

/**
 * The review button: counts the first press, then sends the customer to the account's STORED link. Where it goes
 * is never read from the request (no url, redirect or next field is looked at); a stored link that is not http(s)
 * is treated as none. redirect() from an action answers a POST with a 303.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the form body is deliberately never read
export async function reviewLinkAction(token: string, _formData: FormData): Promise<void> {
  const read = readCheckinToken(token);
  if (!read.ok) return;
  const url = await reviewLinkTarget(serviceDb(), read.payload);
  if (url && isWebUrl(url)) redirect(url);
  redirect(`/r/${token}`);
}

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
