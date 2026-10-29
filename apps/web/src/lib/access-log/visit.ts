import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  serviceDb, startAgencyVisit, readAgencyActorName, newestAgencyVisitStart, isAgencyVisitReason,
  AGENCY_VISIT_HOURS, type AgencyVisitReason,
} from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";

/** The longest name stored on a visit. */
const MAX_NAME = 200;
/** The chooser says "your last visit here ended" for this long after the end (spec 3.2). */
const ENDED_HINT_HOURS = 12;
const HOUR_MS = 3_600_000;

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t.slice(0, MAX_NAME) : null;
}

/** The signed-in person's own Clerk record, only when it is `clerkUserId`'s; a Clerk failure is null, never a throw. */
async function clerkProfile(clerkUserId: string): Promise<{ fullName: string | null; email: string | null } | null> {
  try {
    const u = await currentUser();
    if (!u || u.id !== clerkUserId) return null;
    return { fullName: u.fullName ?? null, email: u.primaryEmailAddress?.emailAddress ?? null };
  } catch (e) {
    console.error(`access log: Clerk profile unavailable: ${loggableError(e)}`);
    return null;
  }
}

/**
 * F-118 part 1: the name an Owner reads on a BIS visit. `users.name` first (Clerk is not asked), then Clerk's
 * full name, then `users.email`, then Clerk's primary email, then null (the reader shows "Someone at BIS").
 * Trimmed and clipped. A failed `users` read throws: the visit start runs on the same database.
 */
export async function actorNameFor(clerkUserId: string): Promise<string | null> {
  const stored = await readAgencyActorName(serviceDb(), clerkUserId);
  const name = clean(stored?.name);
  if (name) return name;
  const profile = await clerkProfile(clerkUserId);
  return clean(profile?.fullName) ?? clean(stored?.email) ?? clean(profile?.email);
}

/**
 * F-118 part 1 (spec 3.2): start (or find) the caller's live visit to this account for this reason, keyed by
 * their own Clerk user and session, never a value from the browser. `requireAgency()` first. An unknown
 * reason or a non-UUID id starts nothing (null), and so does an account that does not exist (the wrapper's
 * null). A failed write throws.
 */
export async function startVisitForCaller(accountId: string, reason: AgencyVisitReason): Promise<string | null> {
  const { userId } = await requireAgency();
  const { sessionId, actor } = await auth();
  // T3 review minor 3 (owner ruling 5): a session signed in AS someone else never starts a visit in their name.
  if (actor) redirect("/no-access?reason=none");
  if (!sessionId) redirect("/sign-in");
  if (!isAgencyVisitReason(reason) || !isUuid(accountId)) return null;
  const name = await actorNameFor(userId);
  return startAgencyVisit(serviceDb(), accountId, { clerkUserId: userId, sessionId, name }, reason);
}

/**
 * The chooser's lead line (spec 3.2, plan C15): true when this person's newest visit to this account in this
 * session has ended (the window is exact: a start `AGENCY_VISIT_HOURS` ago has ended) and ended within the
 * last 12 hours, by the app's clock against the start read on the service client.
 */
export async function lastVisitEndedRecently(accountId: string, now: Date = new Date()): Promise<boolean> {
  const { userId } = await requireAgency();
  const { sessionId } = await auth();
  if (!sessionId || !isUuid(accountId)) return false;
  const start = await newestAgencyVisitStart(serviceDb(), accountId, { clerkUserId: userId, sessionId });
  if (start === null) return false;
  const age = now.getTime() - Date.parse(start);
  return age >= AGENCY_VISIT_HOURS * HOUR_MS && age < (AGENCY_VISIT_HOURS + ENDED_HINT_HOURS) * HOUR_MS;
}
