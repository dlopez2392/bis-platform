/**
 * THE SWITCH (spec section 4: "the non-payment pause, behind its own switch";
 * owner answer Q8). `BILLING_ENFORCE=1` turns on, together: the pause pass's
 * writes; every reader of the billing verdict (the SMS and email gates and the
 * automation hold, the TeXML route, the concierge, the AI summary, read-only
 * client actions, the paused banner); the usage report's 20-hour hold; and
 * the nightly step (re-reads, reconciliation, held sends, permission heal).
 * Exactly "1" is on. Off is the whole rollback. Needs a redeploy.
 */
export function billingEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BILLING_ENFORCE === "1";
}
