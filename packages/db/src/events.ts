import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserClient } from "./user-client";

export type ActorType = "user" | "system" | "ai";

/**
 * The one place a domain event is written.
 *
 * This helper previously existed as five byte-identical copies (accounts,
 * contacts, activities, opportunities, messaging). M1b fixed only messaging's
 * copy to accept a non-user actor, which is exactly how the Resend webhook came
 * to log `actor_type='user'` in the first place — the fix could not reach the
 * other four. One copy, so the next fix cannot miss anyone.
 * User clients go through record_event (0053); see the body.
 */
export async function emit(
  db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object,
  actorType: ActorType = "user",
): Promise<void> {
  if (isUserClient(db)) {
    // 0053: the client role cannot INSERT into events. It appends through
    // public.record_event, which writes actor_type 'user' and actor_id = the
    // request JWT's sub, and applies the account check the old policy did.
    // actorId/actorType are deliberately NOT sent: the database takes the
    // actor from the token, not from the caller. A non-user actor on a user
    // client would be relabelled 'user' by the database, so it is refused here
    // instead: emit a system/ai event from server code (serviceDb).
    if (actorType !== "user") {
      throw new Error(`event emit failed: a signed-in user's client cannot record a '${actorType}' event (${type})`);
    }
    const { error } = await db.rpc("record_event",
      { p_account_id: accountId, p_type: type, p_payload: payload });
    if (!error) return;
    // TEMPORARY - remove once 0053 is on production. Until then production
    // has no record_event, so this build falls back to the direct insert
    // there. PGRST202 is PostgREST's "no such function"; every other error
    // is real and throws.
    if (error.code !== "PGRST202") throw new Error(`event emit failed: ${error.message}`);
  }
  const { error } = await db.from("events").insert({
    account_id: accountId, type, actor_type: actorType, actor_id: actorId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}

export type EventRow = {
  id: string;
  type: string;
  actorType: ActorType;
  payload: unknown;
  createdAt: string;
};

/**
 * The ledger's first READ helper (Task 7, dashboard activity feed — its only
 * consumer today). Newest first, capped at `limit`, account-scoped like
 * every other per-account reader in this package. `type` here is the raw,
 * internal event string (`"booking.created"`, `"call.recorded"`, …) — never
 * render it directly on a screen (DESIGN.md: never expose internal codes);
 * the caller curates a small set of known types into honest copy and skips
 * everything else silently.
 */
export async function listRecentEvents(
  db: SupabaseClient, accountId: string, limit: number,
): Promise<EventRow[]> {
  const { data, error } = await db.from("events")
    .select("id, type, actor_type, payload, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentEvents failed: ${error.message}`);
  return (data ?? []).map(
    (r: { id: number | string; type: string; actor_type: ActorType; payload: unknown; created_at: string }) => ({
      id: String(r.id),
      type: r.type,
      actorType: r.actor_type,
      payload: r.payload,
      createdAt: r.created_at,
    }),
  );
}
