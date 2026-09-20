import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One minted browser session. `ticketNonce` is the NONCE SEGMENT ALONE of
 * the website ticket (web-demo.ts's `<issuedAtMs>.<nonce>.<hmac>`) — the
 * middle part `verifyTicket` returns as `verdict.nonce`, not the whole
 * dot-joined string. The unique index is what turns that segment
 * single-use; passing the full `<issuedAtMs>.<nonce>.<hmac>` string here
 * instead would defeat it silently, because `issuedAtMs` changes on every
 * mint and a replayed ticket would therefore always look like a fresh key.
 */
export type WebSessionRecord = {
  accountId: string; ticketNonce: string; ipHash: string; origin: string | null;
};

/**
 * Records a minted session. Returns FALSE when this nonce was already used —
 * a replay, which the caller refuses — and throws on anything else.
 *
 * The distinction matters: a replay is an expected, refusable outcome of a
 * ticket that is valid but spent, while a broken database is not something
 * to answer with "forbidden". 23505 is the unique-violation code, the same
 * one createContact's duplicate-flag insert treats as the designed outcome
 * (contacts.ts).
 */
export async function recordWebSession(
  db: SupabaseClient, input: WebSessionRecord,
): Promise<boolean> {
  const { error } = await db.from("voice_web_sessions").insert({
    account_id: input.accountId,
    ticket_nonce: input.ticketNonce,
    ip_hash: input.ipHash,
    origin: input.origin,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`recordWebSession failed: ${error.message}`);
}

/** Sessions minted for this hashed IP since `sinceIso`. */
export async function countWebSessionsByIp(
  db: SupabaseClient, ipHash: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("voice_web_sessions")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", sinceIso);
  if (error) throw new Error(`countWebSessionsByIp failed: ${error.message}`);
  return count ?? 0;
}

/** Sessions minted against this account since `sinceIso`. The per-tenant
 *  ceiling: one client's public page must not exhaust a budget alone. */
export async function countWebSessionsForAccount(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("voice_web_sessions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("created_at", sinceIso);
  if (error) throw new Error(`countWebSessionsForAccount failed: ${error.message}`);
  return count ?? 0;
}
