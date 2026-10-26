import { cache } from "react";
import { isConciergeLive, readBillingStanding, serviceDb } from "@bis/db";
import { billingEnforced } from "./enforce";
import { ALL_ON, billingVerdict, pauseCause, type BillingVerdict } from "./standing";

/** The verdict plus what the paused banner and the card say about it: why (`cause`) and since when. */
export type AccountBillingVerdict = BillingVerdict & { cause: "payment" | "ended" | null; pausedAt: string | null };
const NOTHING_PAUSED: AccountBillingVerdict = Object.freeze({ ...ALL_ON, cause: null, pausedAt: null });

/**
 * The account's billing verdict for THIS request, read once (React cache):
 * the paused banner, the read-only guard, the concierge page and layout, and
 * the AI summary route. M7a PR-4, plan G5, G10, G11, G12, G21.
 *
 * serviceDb, on purpose (plan Global Constraints): a client Staff session
 * reads NO account_billing row (0066 account_billing_owner_read), and
 * `plans` is agency-read only, yet every member must be told the account is
 * paused. It returns booleans and a cause about the ACCOUNT, never customer
 * data, and every caller has already run requireAccountAccess (or is the
 * public concierge, whose public id is its authorisation).
 *
 * FAILS OPEN: a read error is nothing paused, logged. Switch off: no read.
 */
export const billingVerdictFor = cache(async (accountId: string): Promise<AccountBillingVerdict> => {
  if (!billingEnforced()) return NOTHING_PAUSED;
  try {
    const standing = await readBillingStanding(serviceDb(), accountId);
    const verdict = billingVerdict(standing, true, new Date());
    return {
      ...verdict,
      cause: verdict.paused && standing ? pauseCause(standing) : null,
      pausedAt: verdict.paused ? standing?.pausedAt ?? null : null,
    };
  } catch (e) {
    console.error(`billing standing read failed for account ${accountId}; treated as not paused: ${e instanceof Error ? e.message : String(e)}`);
    return NOTHING_PAUSED;
  }
});

/** The concierge is open: switched on, a published destination
 *  (isConciergeLive) AND the account's billing allows the chat (G10, Q5).
 *  A chat that is not live never reads billing. */
export async function conciergeOpen(
  profile: Parameters<typeof isConciergeLive>[0] & { account_id: string },
): Promise<boolean> {
  return isConciergeLive(profile) && (await billingVerdictFor(profile.account_id)).concierge;
}
