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
