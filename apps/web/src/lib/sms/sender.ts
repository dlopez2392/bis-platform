import { getA2pRegistration, type SupabaseClient } from "@bis/db";

export type SmsGate =
  | { ok: true; from: string; ownedNumbers: string[] }
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
 *
 * The read asks for `testing` rows too, alongside `live` — one more
 * predicate on the query already being made here, not a second round trip.
 * `from` is still computed from `live` rows only (a `testing` number is not
 * cleared to send FROM), but `ownedNumbers` carries every row this account
 * OWNS by `api/sms/inbound/route.ts`'s own definition of "owned" (`testing`
 * OR `live`). That broader set is what `refusesAlertLoop` needs: a second
 * owned number, even one still mid-provisioning, was an unguarded loop when
 * this function only ever reported the single one it picked to send from
 * (finding 2, alert-send-report follow-up review).
 */
export async function resolveSmsSender(
  db: SupabaseClient, accountId: string,
): Promise<SmsGate> {
  const a2p = await getA2pRegistration(db, accountId);
  if (a2p?.status !== "approved") return { ok: false, reason: "a2p_not_approved" };

  const { data, error } = await db.from("phone_numbers")
    .select("e164, status, created_at")
    .eq("account_id", accountId)
    .in("status", ["testing", "live"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`resolveSmsSender failed: ${error.message}`);

  const rows = (data ?? []) as { e164: string; status: string }[];
  const first = rows.find((row) => row.status === "live");
  if (!first) return { ok: false, reason: "no_live_number" };
  return { ok: true, from: first.e164, ownedNumbers: rows.map((row) => row.e164) };
}

/**
 * THE loop guard 0035_alert_phone.sql's own comment says belongs to the send
 * path, never the schema. `alert_phone` can equal ANY number this account
 * owns — not only the single one `resolveSmsSender` happens to pick to send
 * FROM. A `phone_numbers` row walks to `live` (or sits at `testing`) on its
 * own, with no write to `accounts` to fire on (see the migration's decision
 * 3), and `api/sms/inbound/route.ts` treats `testing` OR `live` as owned —
 * so a second owned row, even one still mid-provisioning, was an unguarded
 * loop when this only compared against the resolved sender (finding 2,
 * alert-send-report follow-up review). Texting a number this account owns
 * would have that route create a CONTACT for the business owner and a
 * conversation with them — the platform quietly filing its own operator as
 * their own lead.
 *
 * Call this with the destination already in hand and `ownedNumbers` from the
 * SAME `resolveSmsSender` call — the only moment the comparison is current,
 * per the migration's own reasoning. Logs the offending `alert_phone` and the
 * full owned-numbers list it matched against — deliberately not described as
 * "both numbers": when an account owns exactly one number (today's only
 * reachable case), that list and `alert_phone` are the same value, so there
 * is nothing else to also print.
 */
export function refusesAlertLoop(accountId: string, alertPhone: string, ownedNumbers: string[]): boolean {
  if (!ownedNumbers.includes(alertPhone)) return false;
  console.error(
    `alert SMS refused for account ${accountId}: alert_phone ${alertPhone} matches one of this ` +
    `account's own numbers (${ownedNumbers.join(", ")}) — texting it would create a contact and ` +
    "conversation for the business's own owner",
  );
  return true;
}
