"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAccountAccess } from "@/lib/auth";
import { readAccountBilling } from "@/lib/billing/account-billing-read";
import { loggableError } from "@/lib/billing/billing-link";
import { openPortal } from "@/lib/billing/portal";
import { billingGatewayFromEnv } from "@/lib/billing/stripe-gateway";
import { configuredOrigin, originFrom } from "@/lib/email/origin";
import { m } from "@/lib/messages";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const failed = { ok: false as const, error: m["billing.page.portalFailed"] };

/**
 * Manage billing (spec section 5): a Stripe Customer Portal session for
 * THIS account's customer. requireAccountAccess first: a client is
 * redirected to its own dashboard for any other account id, so a client can
 * only ever open its own portal. The row is then read on the caller's RLS
 * client, like the page reads it, so the database backstop stands behind
 * the guard too.
 *
 * There is no portal URL until Stripe returns one: the session is made on
 * the click, and on success this REDIRECTS (never returns) to exactly the
 * URL the gateway returned. Every failure is the one plain sentence; the
 * log names the account and goes through loggableError, which redacts
 * email addresses from Stripe's messages.
 *
 * ASSUMPTION B9, UNVERIFIED here: redirect() to an absolute external URL
 * from a server action works in Next 16 (documented). Task 12's e2e portal
 * click proves it.
 */
export async function openBillingPortalAction(accountId: string): Promise<{ ok: false; error: string }> {
  const { isAgency } = await requireAccountAccess(accountId);
  if (!UUID.test(accountId)) return failed;
  // Inside a try: a rejected action would swap the whole page for the error
  // boundary, and this is a button whose failure is one sentence.
  let customerId: string | null;
  try {
    customerId = (await readAccountBilling(accountId))?.stripeCustomerId ?? null;
  } catch (e) {
    console.error(`billing portal: billing read failed for account ${accountId}: ${loggableError(e)}`);
    return failed;
  }
  // Complimentary or unbilled: the page shows no button, so this is a stale
  // page or a hand-made call. Nothing to log.
  if (!customerId) return failed;
  // The two configuration faults are LOGGED: each breaks Manage billing for
  // every client at once, and the client only ever sees the one sentence.
  const gateway = billingGatewayFromEnv();
  if (!gateway.ok) {
    console.error(`billing portal: Stripe not usable (${gateway.reason}) for account ${accountId}`);
    return failed;
  }
  const origin = configuredOrigin() ?? originFrom(await headers());
  if (!origin) {
    console.error(`billing portal: no origin to return to (APP_ORIGIN unset and no Host header) for account ${accountId}`);
    return failed;
  }
  let url: string;
  try {
    url = await openPortal(gateway.gateway, {
      customerId, returnUrl: `${origin}/dashboard/accounts/${accountId}/billing`,
    });
  } catch (e) {
    console.error(`billing portal: failed for account ${accountId}: ${loggableError(e)}`);
    return failed;
  }
  // The route works for the agency (G20), and then it opens a CLIENT's
  // card and invoices: leave a trace. The account id only.
  if (isAgency) console.info(`billing portal: the agency opened the portal for account ${accountId}`);
  redirect(url);
}
