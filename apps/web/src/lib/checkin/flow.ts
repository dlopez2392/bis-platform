import {
  CHECKIN_ANSWERS, ensureCheckinTask, getAutomation, getBranding, getCheckinForBooking, markReviewLinkOpened,
  parseReviewRequestConfig, recordCheckinAnswer,
  type Branding, type CheckinAnswer, type SupabaseClient,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { checkinTaskTitle } from "./copy";
import type { CheckinTokenPayload } from "./token";

/**
 * What the public check-in page and its two actions do with a verified token (F-072, plan D1 to D3). Every function
 * takes the client it is handed and mentions no way to get one: the route files (app/r/[token]) hold the service
 * client, as /u and /d do, and every function here is scoped by the TOKEN's account and booking, never by anything
 * in a request body. The token proves we signed a job; it is never trusted for the customer. The booking is re-read
 * by (account, booking) and must be completed, and recordCheckinAnswer takes the contact from that row.
 */

/** Older than this and the page shows only the review button: records nothing, alerts nobody (plan D1, "dead ends"). */
export const CHECKIN_LINK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type CheckinView =
  /** The booking is not this account's, is not completed, or is gone: never another business's data. */
  | { kind: "not_valid" }
  | { kind: "ask" }
  | { kind: "answered"; answer: CheckinAnswer }
  /** Past 30 days with no answer: the review button alone. */
  | { kind: "expired" };

export type CheckinPage = {
  view: CheckinView;
  branding: Branding | null;
  /** The account's stored review link at render time, or null when it has none (the button is then omitted). */
  reviewUrl: string | null;
};

const isExpired = (p: CheckinTokenPayload, now: Date) => now.getTime() - p.i > CHECKIN_LINK_MAX_AGE_MS;

/** True when this account has a COMPLETED booking with this id: the one re-read every action and the page make. */
async function completedBookingExists(db: SupabaseClient, p: CheckinTokenPayload): Promise<boolean> {
  const { data, error } = await db.from("bookings").select("id")
    .eq("account_id", p.a).eq("id", p.b).eq("status", "completed").maybeSingle();
  if (error) throw new Error(`check-in booking read failed: ${error.message}`);
  return data !== null;
}

/**
 * The account's review link, stored on its review_request recipe and read NOW: never carried in the token, a query
 * string or a form. The recipe's own parser decides what a link is (http or https only); a disabled recipe still
 * answers, because a customer who was sent the check-in earlier should still reach the link they were promised.
 */
async function storedReviewUrl(db: SupabaseClient, accountId: string): Promise<string | null> {
  const row = await getAutomation(db, accountId, "review_request");
  return row ? parseReviewRequestConfig(row.config)?.reviewUrl ?? null : null;
}

/** The page's whole read. READS ONLY: a GET that fetched a link must change nothing. */
export async function loadCheckinPage(db: SupabaseClient, p: CheckinTokenPayload, now: Date): Promise<CheckinPage> {
  if (!(await completedBookingExists(db, p))) return { view: { kind: "not_valid" }, branding: null, reviewUrl: null };
  let branding: Branding | null = null;
  try {
    branding = await getBranding(db, p.a);
  } catch (e) {
    // Decorative: a branding blip never costs a customer the page.
    console.error(`check-in page: branding unreadable for account ${p.a}: ${loggableError(e)}`);
  }
  const reviewUrl = await storedReviewUrl(db, p.a);
  const found = await getCheckinForBooking(db, p.a, p.b);
  if (found) return { view: { kind: "answered", answer: found.answer }, branding, reviewUrl };
  return { view: isExpired(p, now) ? { kind: "expired" } : { kind: "ask" }, branding, reviewUrl };
}

async function taskTitle(db: SupabaseClient, accountId: string, contactId: string): Promise<string> {
  const [contact, account] = await Promise.all([
    db.from("contacts").select("first_name, last_name").eq("account_id", accountId).eq("id", contactId).maybeSingle(),
    db.from("accounts").select("language").eq("id", accountId).maybeSingle(),
  ]);
  if (contact.error) throw new Error(`check-in contact read failed: ${contact.error.message}`);
  if (account.error) throw new Error(`check-in account read failed: ${account.error.message}`);
  const c = contact.data as { first_name: string | null; last_name: string | null } | null;
  const name = [c?.first_name, c?.last_name].map((s) => s?.trim()).filter(Boolean).join(" ");
  // Staff read the To-do: the ACCOUNT's language, never the customer's.
  return checkinTaskTitle((account.data as { language: string | null } | null)?.language === "es" ? "es" : "en", name);
}

/**
 * The customer's press on one of the three answers. "done" means the page should simply be shown again (it
 * re-reads, so it says what is true: the thank-you, the expired state, or not valid); "retry" is the designed
 * "something went wrong, please tap again" and means NOTHING was recorded.
 *
 *  - An answer that is not one of the three, or a token past 30 days, writes nothing.
 *  - recordCheckinAnswer decides first-wins at the database. A "not great" (recorded now OR found already there)
 *    asks for its ONE To-do on the winner's check-in id; the unique index makes every call after the first a no-op.
 *    A throw (a contact merge moved the booking between its
 *    read and its insert, 23503, or any database fault) is "retry".
 *  - A To-do that cannot be opened after retries is logged and the customer is still thanked: the answer stands, and
 *    a replay (or PR 3's sweep) asks for the To-do again.
 */
export async function answerCheckin(
  db: SupabaseClient, p: CheckinTokenPayload, answer: unknown, now: Date,
): Promise<"done" | "retry"> {
  if (typeof answer !== "string" || !(CHECKIN_ANSWERS as readonly string[]).includes(answer)) return "done";
  if (isExpired(p, now)) return "done";
  let result;
  try {
    result = await recordCheckinAnswer(db, p.a, p.b, answer as CheckinAnswer);
  } catch (e) {
    console.error(`check-in page: account ${p.a}, booking ${p.b}: the answer was not recorded: ${loggableError(e)}`);
    return "retry";
  }
  if (result.status === "gone" || result.checkin.answer !== "not_great") return "done";
  // The WINNER's check-in, whichever call this is: a replay of a not-great answer re-asks for the same To-do, which
  // is a no-op when it exists (tasks_review_checkin_once, ensureCheckinTask's 23505 branch) and repairs it when the
  // first call's insert failed. A few bounded attempts, as the stamps do (stampWithRetry: under a second in all).
  const checkin = result.checkin;
  const opened = await stampWithRetry(async () => {
    const title = await taskTitle(db, p.a, checkin.contactId);
    await ensureCheckinTask(db, p.a, checkin, { title, dueAt: now.toISOString() }, "checkin-page", "system");
  });
  if (!opened.stamped) {
    console.error(`check-in page: account ${p.a}, booking ${p.b}: a not-great answer is recorded but its To-do may not exist (the title read, the insert or its event failed after ${opened.attempts} attempts): ${loggableError(opened.lastError)}`);
  }
  return "done";
}

/**
 * The review button's press: stamps `review_link_opened_at` (the first press only) and answers where to go, the
 * account's STORED link. Null when there is nothing safe to open: the booking is not this account's completed one,
 * or the account has no review link. The age of the token does not matter here: a late reviewer is welcome. A stamp
 * that fails is logged and never costs the customer the link.
 */
export async function reviewLinkTarget(db: SupabaseClient, p: CheckinTokenPayload): Promise<string | null> {
  if (!(await completedBookingExists(db, p))) return null;
  const url = await storedReviewUrl(db, p.a);
  if (!url) return null;
  try {
    await markReviewLinkOpened(db, p.a, p.b);
  } catch (e) {
    console.error(`check-in page: account ${p.a}, booking ${p.b}: the review press was not counted: ${loggableError(e)}`);
  }
  return url;
}
