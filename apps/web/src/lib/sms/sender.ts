import { getA2pRegistration, type SupabaseClient } from "@bis/db";

export type SmsGate =
  | { ok: true; from: string }
  | { ok: false; reason: "a2p_not_approved" | "no_live_number" };

/**
 * THE gate. Every send path consults this and none re-derives it — two gates
 * that can disagree is how a number ends up blocked for the wrong stated
 * reason, or texted from one that was never cleared.
 *
 * This is also the `isClearedToText` predicate the A2P review asked for, and
 * it FAILS CLOSED by construction: a null read (row missing, or invisible to
 * this client under RLS) resolves to `a2p_not_approved`, never to cleared.
 *
 * "Live" matches the voice path's own meaning — the status the setup wizard's
 * go-live press sets. Several live rows resolve to the oldest, deterministically,
 * so the sending number cannot change under an account between two sends.
 */
export async function resolveSmsSender(
  db: SupabaseClient, accountId: string,
): Promise<SmsGate> {
  const a2p = await getA2pRegistration(db, accountId);
  if (a2p?.status !== "approved") return { ok: false, reason: "a2p_not_approved" };

  const { data, error } = await db.from("phone_numbers")
    .select("e164, created_at")
    .eq("account_id", accountId)
    .eq("status", "live")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`resolveSmsSender failed: ${error.message}`);

  const first = data?.[0] as { e164: string } | undefined;
  if (!first) return { ok: false, reason: "no_live_number" };
  return { ok: true, from: first.e164 };
}
