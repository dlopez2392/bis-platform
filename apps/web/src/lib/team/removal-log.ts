import { emit, type AccountRole, type PersonLanguage, type SupabaseClient } from "@bis/db";
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
 * readable by the account's own users).
 */

export const MEMBER_REMOVED = "team.member_removed";

export type RemovalRecord = { userId: string; clerkUserId: string; role: AccountRole; language: PersonLanguage | null };
export type Removal = RemovalRecord & { removedAt: string };

export async function recordRemoval(db: SupabaseClient, accountId: string, actorClerkUserId: string, r: RemovalRecord): Promise<void> {
  await emit(db, accountId, MEMBER_REMOVED, actorClerkUserId,
    { userId: r.userId, clerkUserId: r.clerkUserId, role: r.role, language: r.language }, "system");
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
  return { userId, clerkUserId: p.clerkUserId, role: p.role, language: p.language, removedAt: row.created_at };
}
