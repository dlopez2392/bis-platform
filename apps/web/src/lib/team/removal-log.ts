import { emit, type AccountRole, type PersonLanguage, type ReleasedAssignments, type SupabaseClient } from "@bis/db";
import { isAccountRole, isClerkUserId, isPersonLanguage } from "./team-view";

/**
 * What a removal's undo is allowed to restore, written by the server at the
 * moment of removal and read back by the undo, so the undo never takes a
 * person, a role or a language from the browser.
 *
 * Written as actor_type 'system' (actor_id is still the caller), and read
 * back ONLY as 'system': `record_event` (0053) lets any signed-in client,
 * Staff included, append a 'user' event of ANY type and payload to its own
 * account, so a `team.member_removed` written as 'user' could be forged into
 * an undo that admits a stranger. Only the service role can write 'system'.
 *
 * The payload carries ids, role and language, never an email (events are
 * readable by the account's own users). Since F-085 part 1 it also carries
 * `released`: the customers and open tasks the removal took off the person
 * (0068's release_member_assignments), which the undo gives back where they
 * are still Unassigned. A record written before that reads as nothing
 * released.
 */

export const MEMBER_REMOVED = "team.member_removed";

export type RemovalRecord = { userId: string; clerkUserId: string; role: AccountRole; language: PersonLanguage | null; released?: ReleasedAssignments };
export type Removal = RemovalRecord & { released: ReleasedAssignments; removedAt: string };

/** A fresh value each time: callers may hold on to it. */
const nothingReleased = (): ReleasedAssignments => ({ contacts: [], tasks: [] });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Both lists of UUIDs, or nothing released: an id the undo would write is never guessed. */
function parseReleased(v: unknown): ReleasedAssignments {
  if (typeof v !== "object" || v === null) return nothingReleased();
  const r = v as Record<string, unknown>;
  const ids = (x: unknown): x is string[] => Array.isArray(x) && x.every((id) => typeof id === "string" && UUID.test(id));
  return ids(r.contacts) && ids(r.tasks) ? { contacts: r.contacts, tasks: r.tasks } : nothingReleased();
}

export async function recordRemoval(db: SupabaseClient, accountId: string, actorClerkUserId: string, r: RemovalRecord): Promise<void> {
  await emit(db, accountId, MEMBER_REMOVED, actorClerkUserId,
    { userId: r.userId, clerkUserId: r.clerkUserId, role: r.role, language: r.language, released: r.released ?? nothingReleased() }, "system");
}

/** The newest system-written removal of `userId` from this account, or null (none, or a payload that does not parse). */
export async function latestRemoval(db: SupabaseClient, accountId: string, userId: string): Promise<Removal | null> {
  const { data, error } = await db.from("events").select("payload, created_at")
    .eq("account_id", accountId).eq("type", MEMBER_REMOVED).eq("actor_type", "system")
    .eq("payload->>userId", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`latestRemoval failed: ${(error as { message?: string }).message ?? "unknown"}`);
  if (!data) return null;
  const row = data as { payload: unknown; created_at: string };
  const p = (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as Record<string, unknown>;
  if (p.userId !== userId || !isClerkUserId(p.clerkUserId) || !isAccountRole(p.role)) return null;
  if (!(p.language === null || isPersonLanguage(p.language))) return null;
  return { userId, clerkUserId: p.clerkUserId, role: p.role, language: p.language, released: parseReleased(p.released), removedAt: row.created_at };
}
