/**
 * Whether a phone number is actually pointed at this platform at the carrier.
 *
 * A phone number has two halves and, until this module existed, the app owned
 * one of them. `phone_numbers.account_id` decides WHO ANSWERS: the TeXML route
 * resolves a tenant from the dialed number, so the company holding the row is
 * the company Sofía greets a caller as. WHERE THE CALL GOES is a Routing
 * setting on the number in the Telnyx portal, and nothing here wrote or even
 * read it.
 *
 * On 2026-09-16 a number was moved to a new company and still answered as the
 * old one. Every layer was correct: the call arrived as a DIFFERENT number
 * (`calledNumber: '+19565061545'` in the incoming webhook's log), because the
 * carrier was still sending it elsewhere. The platform had no way to see that
 * and no way to say it.
 *
 * Note what this is NOT. Every number points at the SAME TeXML application —
 * the tenant comes from the dialed number, never from the connection — so
 * moving a number between companies needs no carrier change at all. The
 * carrier side has to be right exactly once per number: pointed here, or not.
 * That is the whole question this module answers.
 *
 * Pure and network-free so the verdict is tested directly rather than against
 * a live Telnyx account, the shape lib/accounts/orphans.ts and
 * lib/auth/sole-organization.ts use for the same reason.
 */

/** What Telnyx says about one number. Telnyx returns many more fields. */
export interface TelnyxNumberFacts {
  /** Telnyx's own id for the number — the handle a repair needs. */
  id: string;
  /** The voice connection it currently routes to, or null when it has none. */
  connectionId: string | null;
  /** For telling an operator WHERE it points instead of here. */
  connectionName: string | null;
}

export type RoutingStatus =
  /** Points at our TeXML application. Calls arrive as themselves. */
  | "routed"
  /** At Telnyx, pointed at some other connection. Calls go somewhere else. */
  | "elsewhere"
  /** At Telnyx with no voice connection at all. Calls go nowhere. */
  | "unrouted"
  /** Not in this Telnyx account. We cannot route it and cannot repair it. */
  | "absent"
  /** We could not ask. NEVER an accusation — see below. */
  | "unchecked";

/**
 * The verdict for one number.
 *
 * `expectedConnectionId` is our TeXML application's id, from the environment.
 * Without it there is no yardstick, and the honest answer is "unchecked" —
 * NOT "elsewhere". That distinction is the whole safety property of this
 * module: an operator who sees a healthy number reported as broken stops
 * believing the column, and the first thing a missing env var would do is
 * report every number in the account as misrouted.
 *
 * `found === null` means Telnyx has no such number for this API key. It is
 * reported as its own state rather than folded into "elsewhere" because the
 * remedy is completely different: "elsewhere" is one click to repair, "absent"
 * means the number is at another carrier (or another Telnyx account) and
 * nothing here can touch it.
 */
export function routingStatus(
  found: TelnyxNumberFacts | null,
  expectedConnectionId: string | null,
): RoutingStatus {
  if (!expectedConnectionId) return "unchecked";
  if (!found) return "absent";
  if (!found.connectionId) return "unrouted";
  return found.connectionId === expectedConnectionId ? "routed" : "elsewhere";
}

/**
 * Whether this app can fix it, which is narrower than "something is wrong".
 *
 * `absent` is wrong and NOT repairable — the number is not in the Telnyx
 * account this key can see, so there is nothing to PATCH. Offering a button
 * that can only fail is worse than offering none.
 *
 * `unchecked` is not repairable either, for the stronger reason: we do not
 * know that anything is wrong. Writing a carrier setting on a number we never
 * managed to inspect is how a working line gets broken by a diagnostic.
 */
export function canRepairRouting(status: RoutingStatus): boolean {
  return status === "elsewhere" || status === "unrouted";
}

/** Match a carrier record to one of our numbers, by exact E.164 only. */
export function indexByE164(
  numbers: readonly (TelnyxNumberFacts & { phoneNumber: string })[],
): Map<string, TelnyxNumberFacts> {
  const byE164 = new Map<string, TelnyxNumberFacts>();
  for (const n of numbers) byE164.set(n.phoneNumber, n);
  return byE164;
}
