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

/**
 * THE loop guard 0035_alert_phone.sql's own comment says belongs to the send
 * path, never the schema. `alert_phone` can equal an account's own live
 * sending number — nothing in the CHECK constraint or a trigger can catch
 * it, because a `phone_numbers` row walks to `live` on its own, with no
 * write to `accounts` to fire on (see the migration's decision 3). Texting
 * that number would have `api/sms/inbound/route.ts` create a CONTACT for
 * the business owner and a conversation with them — the platform quietly
 * filing its own operator as their own lead.
 *
 * Call this with the destination already in hand and the FROM number
 * `resolveSmsSender` just resolved — the only moment the comparison is
 * current, per the migration's own reasoning. Logs BOTH numbers, because a
 * log naming only one of them cannot be told apart from any other refusal.
 */
export function refusesAlertLoop(accountId: string, alertPhone: string, from: string): boolean {
  if (alertPhone !== from) return false;
  console.error(
    `alert SMS refused for account ${accountId}: alert_phone ${alertPhone} is this ` +
    `account's own sending number ${from} — texting it would create a contact and ` +
    "conversation for the business's own owner",
  );
  return true;
}
