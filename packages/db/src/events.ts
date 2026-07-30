import type { SupabaseClient } from "@supabase/supabase-js";

export type ActorType = "user" | "system" | "ai";

/**
 * The one place a domain event is written.
 *
 * This helper previously existed as five byte-identical copies (accounts,
 * contacts, activities, opportunities, messaging). M1b fixed only messaging's
 * copy to accept a non-user actor, which is exactly how the Resend webhook came
 * to log `actor_type='user'` in the first place — the fix could not reach the
 * other four. One copy, so the next fix cannot miss anyone.
 */
export async function emit(
  db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object,
  actorType: ActorType = "user",
): Promise<void> {
  const { error } = await db.from("events").insert({
    account_id: accountId, type, actor_type: actorType, actor_id: actorId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}
