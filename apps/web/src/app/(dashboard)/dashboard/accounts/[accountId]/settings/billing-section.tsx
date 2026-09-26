import { getBillingLink, listPlans, serviceDb, sumUsageSince } from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { readAccountBilling } from "@/lib/billing/account-billing-read";
import { billingCardView, safeZone, usagePeriodStart, type BillingCardView } from "@/lib/billing/billing-view";
import { stripeKeyVerdict, type StripeEnv } from "@/lib/billing/stripe-gateway";
import { changePlanAction, markComplimentaryAction, removeComplimentaryAction, sendBillingLinkAction } from "./billing-actions";
import { BillingCard, BillingCardError } from "./billing-card";

export { BillingCardError, BillingCardSkeleton } from "./billing-card";

/**
 * Loads the Billing card. Runs INSIDE the Settings page, after its
 * requireAgencyOnlyAccountAccess. Fails SOFT: a billing failure must never
 * take Settings offline, because the page also hosts the client-access
 * switch (the Vercel-projects precedent there).
 *
 * The account_billing row comes from readAccountBilling: the request-cached
 * read the account layout's payment-failed banner already makes (RLS client;
 * 0051 lets the agency read it), so a Settings visit reads it ONCE. The rest
 * goes through serviceDb(): billing_links is service-role only (0052), and
 * the plans, the account's addresses and its usage are read the same way
 * the actions read them.
 */
async function loadBillingCardView(accountId: string, now: Date): Promise<BillingCardView> {
  const db = serviceDb();
  const [billing, link, plans, account] = await Promise.all([
    readAccountBilling(accountId),
    getBillingLink(db, accountId),
    listPlans(db),
    db.from("accounts").select("timezone, reply_to_email, report_emails").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`billing card: account read failed: ${error.message}`);
        if (!data) throw new Error("billing card: account not found");
        return data as { timezone: string | null; reply_to_email: string | null; report_emails: string[] | null };
      }),
  ]);
  const zone = safeZone(account.timezone);
  const plan = billing ? plans.find((p) => p.id === billing.planId) ?? null : null;
  const used = billing ? await sumUsageSince(db, accountId, usagePeriodStart(billing, zone, now).start.toISOString()) : null;
  return billingCardView({
    billing, link, plan, activePlans: plans.filter((p) => !p.archivedAt), used, zone, now,
    // G18: the reply-to address, else the first weekly-report address.
    defaultEmail: account.reply_to_email ?? account.report_emails?.[0] ?? "",
    stripeReady: stripeKeyVerdict(process.env as StripeEnv).ok,
  });
}

export async function BillingSection({ accountId }: { accountId: string }) {
  // Its own guard, OUTSIDE the try: Settings already ran
  // requireAgencyOnlyAccountAccess, but this must stay safe wherever it is
  // mounted next, and a redirect must not be caught into the error card.
  await requireAgency();
  let view: BillingCardView;
  try {
    view = await loadBillingCardView(accountId, new Date());
  } catch (e) {
    console.error(`settings: billing card unavailable for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return <BillingCardError />;
  }
  // accountId is bound here, server-side. It never travels as a form field.
  return (
    <BillingCard
      view={view}
      send={sendBillingLinkAction.bind(null, accountId)}
      markComplimentary={markComplimentaryAction.bind(null, accountId)}
      stopComplimentary={removeComplimentaryAction.bind(null, accountId)}
      changePlan={changePlanAction.bind(null, accountId)}
    />
  );
}
