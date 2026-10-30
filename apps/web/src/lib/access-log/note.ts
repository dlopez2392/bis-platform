import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { serviceDb, noteAgencyOpen, type OpenedRef } from "@bis/db";
import { BIS_PATH_HEADER, enterHref, safeReturnPath } from "./paths";

/** The access value the surface's own guard returned; only isAgency is read. */
export type NoteAccess = { isAgency: boolean };

/**
 * F-118 part 1 (spec 4.2): the ONE place a record open is written. Called by every record surface AFTER its
 * own proof that the record exists in this account, and BEFORE any of it leaves the server. A client is never
 * logged and pays nothing. A failed write THROWS (owner ruling 4: fail closed). The write is service_role
 * only (0105) and re-checks the live visit itself, keyed by the session's own person and session, never a
 * value from the browser.
 */
async function note(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<"client" | "ok" | "no_visit"> {
  if (!access.isAgency) return "client";
  const { userId, sessionId } = await auth();
  if (!userId || !sessionId) return "no_visit";
  return noteAgencyOpen(serviceDb(), accountId, { clerkUserId: userId, sessionId }, ref);
}

/** Pages and server actions: no live visit sends the person to the chooser. */
export async function noteOpened(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<void> {
  if ((await note(access, accountId, ref)) !== "no_visit") return;
  redirect(enterHref(accountId, safeReturnPath((await headers()).get(BIS_PATH_HEADER), accountId)));
}

/**
 * Route handlers: false means answer the route's usual 404. Always called as
 * `if (!(await noteOpenedApi(…))) return …` (the route walk pins the shape).
 */
export async function noteOpenedApi(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<boolean> {
  return (await note(access, accountId, ref)) !== "no_visit";
}
