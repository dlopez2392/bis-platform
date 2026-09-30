import { clerkClient } from "@clerk/nextjs/server";
import { loggableError } from "@/lib/loggable-error";

/**
 * The staff member's name for "confirmed by Ana" (spec §6; plan G14): no
 * table holds it (public.users has no writer), so it is Clerk's, read when
 * the ledger row is written and kept in the row's evidence. Clerk
 * unreachable is `null`, never a failed action.
 */
export async function actorName(userId: string): Promise<string | null> {
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    return user.firstName?.trim() || user.fullName?.trim() || null;
  } catch (e) {
    console.error(`actorName: Clerk read for ${userId} failed: ${loggableError(e)}`);
    return null;
  }
}
