"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  serviceDb, readPersonId, createCalendarFeed, replaceCalendarFeed, revokeCalendarFeed, restoreCalendarFeed,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { feedSecretConfigured, feedToken, feedTokenHash } from "@/lib/booking/feed-token";
import { loggableError } from "@/lib/loggable-error";

/**
 * F-048 part 2: make, replace, turn off and undo the SIGNED-IN person's own calendar link. Every write is
 * keyed by readPersonId(route account, the caller's Clerk id); the Undo payload carries no person, so a
 * forged one can only name a row restore_calendar_feed then refuses (it scopes by account AND user).
 * Every member may act (owner decision D1); the agency has no link. Make my link is refused while the
 * account is paused, as every client write is (auth.ts); the three protective actions below are not.
 */
export type FeedUndo = { feedId: string; revokedAt: string; replacementId: string | null };
export type FeedErrorKey =
  | "calendar.feed.error.failed" | "calendar.feed.error.notMember"
  | "calendar.feed.error.unavailable" | "calendar.feed.error.undoLate";
export type FeedActionResult = { ok: true; undo: FeedUndo | null } | { ok: false; error: FeedErrorKey };

type Me = { db: ReturnType<typeof serviceDb>; personId: string; clerkUserId: string };

/** The signed-in person's users.id in THIS account, or null for the agency or a non-member. No guard of its own:
 *  each action calls requireAccountAccess itself, so the pause option is visible in the action's body. */
async function person(accountId: string, clerkUserId: string, isAgency: boolean): Promise<Me | null> {
  if (isAgency) return null;
  const db = serviceDb();
  const personId = await readPersonId(db, accountId, clerkUserId);
  return personId ? { db, personId, clerkUserId } : null;
}

const fail = (what: string, e: unknown): FeedActionResult => {
  console.error(`calendar feed: ${what} failed: ${loggableError(e)}`);
  return { ok: false, error: "calendar.feed.error.failed" };
};

/** Make my link: an ordinary write, refused during a pause (the default guard). "exists" (a second click
 *  raced the first) is still a link the person has, so it answers ok and the refresh shows it. */
export async function makeFeedLinkAction(accountId: string): Promise<FeedActionResult> {
  if (!feedSecretConfigured()) return { ok: false, error: "calendar.feed.error.unavailable" };
  // Outside the try: its redirect (signed out, or paused) must reach Next, never read as "didn't save".
  const { userId, isAgency } = await requireAccountAccess(accountId);
  try {
    const who = await person(accountId, userId, isAgency);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const id = randomUUID();
    await createCalendarFeed(who.db, { accountId, userId: who.personId, id, tokenHash: feedTokenHash(feedToken(id)), createdBy: who.clerkUserId });
    revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
    return { ok: true, undo: null };
  } catch (e) { return fail("make", e); }
}

// The three PROTECTIVE actions below stay open during a billing pause (coordinator decision on review I3): a
// leaked link must be closable while the account is read-only. Each passes the option to its OWN awaited
// guard in its body, and none revalidates (lib/billing/read-only.test.ts pins both); the card's handlers
// refresh the page instead.

export async function replaceFeedLinkAction(accountId: string): Promise<FeedActionResult> {
  if (!feedSecretConfigured()) return { ok: false, error: "calendar.feed.error.unavailable" };
  // Outside the try: its redirect (signed out, or paused) must reach Next, never read as "didn't save".
  const { userId, isAgency } = await requireAccountAccess(accountId, { duringPause: "allow" });
  try {
    const who = await person(accountId, userId, isAgency);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const newId = randomUUID();
    const newHash = feedTokenHash(feedToken(newId));
    const r = await replaceCalendarFeed(who.db, { accountId, userId: who.personId, newId, newHash, createdBy: who.clerkUserId });
    if (r.status === "none") {
      await createCalendarFeed(who.db, { accountId, userId: who.personId, id: newId, tokenHash: newHash, createdBy: who.clerkUserId });
      return { ok: true, undo: null };
    }
    return { ok: true, undo: { feedId: r.previousId, revokedAt: r.revokedAt, replacementId: newId } };
  } catch (e) { return fail("replace", e); }
}

export async function turnOffFeedLinkAction(accountId: string): Promise<FeedActionResult> {
  // Outside the try: its redirect (signed out, or paused) must reach Next, never read as "didn't save".
  const { userId, isAgency } = await requireAccountAccess(accountId, { duringPause: "allow" });
  try {
    const who = await person(accountId, userId, isAgency);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const r = await revokeCalendarFeed(who.db, accountId, who.personId);
    return { ok: true, undo: r ? { feedId: r.feedId, revokedAt: r.revokedAt, replacementId: null } : null };
  } catch (e) { return fail("turn off", e); }
}

export async function undoFeedLinkAction(accountId: string, undo: FeedUndo): Promise<FeedActionResult> {
  // Outside the try: its redirect (signed out, or paused) must reach Next, never read as "didn't save".
  const { userId, isAgency } = await requireAccountAccess(accountId, { duringPause: "allow" });
  try {
    const who = await person(accountId, userId, isAgency);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const r = await restoreCalendarFeed(who.db, {
      accountId, userId: who.personId, feedId: undo.feedId, revokedAt: undo.revokedAt, replacementId: undo.replacementId,
    });
    if (r === "changed") return { ok: false, error: "calendar.feed.error.undoLate" };
    return { ok: true, undo: null };
  } catch (e) { return fail("undo", e); }
}
