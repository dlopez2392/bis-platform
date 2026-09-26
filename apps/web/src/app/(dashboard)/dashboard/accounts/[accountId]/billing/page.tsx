import { CreditCard } from "lucide-react";
import { getPlan, serviceDb, sumUsageSince } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccountAccess } from "@/lib/auth";
import { readAccountBilling } from "@/lib/billing/account-billing-read";
import { BILLING_STATUS_TREATMENTS, billingCardView, safeZone, usagePeriodStart } from "@/lib/billing/billing-view";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { openBillingPortalAction } from "./actions";
import { PAYMENT_PROCESSING } from "./client-status";
import { ManageBillingButton } from "./manage-billing-button";

export const dynamic = "force-dynamic";

/**
 * The client's Billing page (spec section 5; G20): plan, usage this period
 * ("312 of 500 minutes", read from usage_events, never the Activity page's
 * counts), the next invoice, and Manage billing. The billing row and the
 * usage are read on the RLS client (0051: a client reads its own rows); the
 * row through `readAccountBilling`, the cached seam the account layout's
 * banner shares, so this navigation reads it once. The PLAN goes through
 * serviceDb() keyed by that row's plan_id (PR-1 binding: plans stays
 * agency-read). Reads are not swallowed: a failure reaches the dashboard
 * error boundary (the Plans page's precedent).
 *
 * The route works for the agency too (hiding the nav item from it is
 * convenience, G20); requireAccountAccess is the boundary.
 */
export default async function BillingPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const [billing, account] = await Promise.all([
    readAccountBilling(accountId),
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle().then(({ data, error }) => {
      if (error) throw new Error(`billing page: account read failed: ${error.message}`);
      return data as { timezone: string | null } | null;
    }),
  ]);
  const header = <PageHeader title={m["billing.page.title"]} subtitle={m["billing.page.subtitle"]} />;
  if (!billing) {
    // DECISION 4: the item is in the client's nav before billing starts, and
    // this says what will appear here and what makes it appear.
    return (
      <>
        {header}
        <div className="p-6">
          <EmptyState icon={CreditCard} title={m["billing.page.empty.title"]} body={m["billing.page.empty.body"]} />
        </div>
      </>
    );
  }

  const plan = await getPlan(serviceDb(), billing.planId);
  if (!plan) throw new Error(`billing page: plan ${billing.planId} of account ${accountId} not found`);
  const zone = safeZone(account?.timezone);
  const now = new Date();
  const used = await sumUsageSince(db, accountId, usagePeriodStart(billing, zone, now).start.toISOString());
  const view = billingCardView({ billing, link: null, plan, activePlans: [], used, zone, now, defaultEmail: "", stripeReady: true });
  // A first payment still going through: the client's word, shown to whoever
  // opens this page, the agency included (it sees the client's page as the
  // client does). The agency's own card on Settings keeps "Payment failed".
  // client-status.ts says why.
  const processing = billing.subscriptionStatus === "incomplete";
  const t = processing ? PAYMENT_PROCESSING : BILLING_STATUS_TREATMENTS[view.status];

  return (
    <>
      {header}
      <div className="space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{plan.name}</CardTitle>
            <CardAction><DotPill label={t.label} chip={t.chip} dot={t.dot} data-status={processing ? "payment_processing" : view.status} /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-foreground tabular-nums">
              {billing.complimentary ? m["billing.page.complimentary"] : view.plan?.price}
            </p>
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-foreground">{m["billing.page.usage"]}</h2>
              <ul className="space-y-1 text-sm tabular-nums text-foreground">
                {view.usage.map((u) => <li key={u.meter} className={u.over ? "font-medium" : undefined}>{u.text}</li>)}
              </ul>
              {view.since ? (
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{view.since}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{m["billing.usage.chatsNote"]}</p>
            </div>
            {view.nextInvoice ? <p className="text-sm text-muted-foreground tabular-nums">{view.nextInvoice}</p> : null}
            {view.status === "canceled" ? <p className="text-sm text-muted-foreground">{m["billing.page.canceled"]}</p> : null}
            {!billing.complimentary && billing.stripeCustomerId ? (
              <ManageBillingButton
                open={openBillingPortalAction.bind(null, accountId)}
                help={view.status === "canceled" ? m["billing.page.manageHelp.canceled"] : m["billing.page.manageHelp"]}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
