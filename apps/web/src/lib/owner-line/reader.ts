// apps/web/src/lib/owner-line/reader.ts
// THE ONE PLACE the Task 0 decision changes behaviour (plan SC-2). Every owner tool reads through the client this
// returns and calls the app's OWN readers with it (listCalls, listAgendaBookings, listAccountWork); no tool filters
// by role itself. "token": the client reads as the person, so RLS (0068) decides, Technicians included. "service"
// (F2): the service role scoped by account id, which equals what an Owner or Staff member sees; a Technician's scope
// lives only in RLS, so they are refused here AND never offered the line (OWNER_LINE_ROLES).
import { userDb, serviceDb, type SupabaseClient } from "@bis/db";
import { OWNER_LINE_DATA_PATH, type OwnerLineDataPath } from "./data-path";
import { mintOwnerLineToken } from "./token";
import type { OwnerLineSession } from "./session";

export function ownerLineReadClient(
  s: Pick<OwnerLineSession, "role" | "clerkUserId" | "clerkOrgId">, now: Date = new Date(),
  deps: { path: OwnerLineDataPath; userDb: typeof userDb; serviceDb: typeof serviceDb; mint: typeof mintOwnerLineToken } =
    { path: OWNER_LINE_DATA_PATH, userDb, serviceDb, mint: mintOwnerLineToken },
): SupabaseClient {
  if (deps.path === "token") return deps.userDb(deps.mint({ clerkUserId: s.clerkUserId, clerkOrgId: s.clerkOrgId }, now.getTime()));
  if (s.role === "technician") throw new Error("owner line: a Technician's reads need the token path (plan SC-2)");
  return deps.serviceDb();
}
