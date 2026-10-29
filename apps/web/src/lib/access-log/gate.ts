import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { serviceDb, agencyVisitLive } from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { BIS_PATH_HEADER, enterHref, safeReturnPath } from "./paths";

/**
 * F-118 part 1 (spec 3.1): the agency's visit, read once per (account, person, session) per request, so the
 * layout, the page and the shell share it. service_role only (0105), so serviceDb(): this runs inside
 * requireAccountAccess, before the caller is admitted. A failed read THROWS (owner ruling 4: fail closed).
 */
const liveVisit = cache((accountId: string, clerkUserId: string, sessionId: string) =>
  agencyVisitLive(serviceDb(), accountId, { clerkUserId, sessionId }));

/**
 * The reason gate for pages, layouts and server actions: returns when this person has a live visit to this
 * account in this sign-in session; otherwise redirects to the chooser, carrying the in-account path the proxy
 * recorded (re-validated here: a path into any other account is dropped). A non-UUID account id is a 404
 * before the read (plan C12: the uuid-typed call would otherwise make it a 500).
 */
export async function requireAgencyVisit(
  accountId: string, clerkUserId: string, sessionId: string | null | undefined,
): Promise<void> {
  if (!sessionId) redirect("/sign-in");
  if (!isUuid(accountId)) notFound();
  if (await liveVisit(accountId, clerkUserId, sessionId)) return;
  const to = safeReturnPath((await headers()).get(BIS_PATH_HEADER), accountId);
  redirect(enterHref(accountId, to));
}

/** The route variant: whether this person has a live visit here. A failed read throws, never `false`. */
export async function agencyVisitOk(
  accountId: string, clerkUserId: string, sessionId: string | null | undefined,
): Promise<boolean> {
  if (!sessionId || !isUuid(accountId)) return false;
  return (await liveVisit(accountId, clerkUserId, sessionId)) !== null;
}

/**
 * Review m5: for a response that must never be a redirect (the customer-list download). True only for an
 * agency session with no live visit for this account; everyone else is left to the route's own guard.
 */
export async function agencyVisitMissing(accountId: string): Promise<boolean> {
  const { userId, sessionId, sessionClaims } = await auth();
  if (!userId || (sessionClaims as { app_role?: string } | null)?.app_role !== "agency_admin") return false;
  if (!isUuid(accountId)) return false;
  return !(await agencyVisitOk(accountId, userId, sessionId));
}
