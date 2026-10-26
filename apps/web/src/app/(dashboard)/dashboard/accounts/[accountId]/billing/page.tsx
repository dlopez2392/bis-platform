import { CreditCard } from "lucide-react";
import { getPlan, serviceDb, sumUsageSince } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccountOwner } from "@/lib/auth";
import { readAccountBilling } from "@/lib/billing/account-billing-read";
import { BILLING_STATUS_TREATMENTS, billingCardView, safeZone, usagePeriodStart } from "@/lib/billing/billing-view";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { dbForRequest } from "@/lib/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { t as tFn } from "@/lib/i18n/t";
import { requestLocale } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { m } from "@/lib/messages";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
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
 * convenience, G20); requireAccountOwner is the boundary — Staff and roles
 * (spec §4): a client Staff is sent to their own dashboard, same as any
 * other owner-only surface, never 403'd (requireAccountAccess's own
 * reasoning).
 */
export default async function BillingPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { isAgency } = await requireAccountOwner(accountId);
  const db = await dbForRequest();
  // The paused line (M7a PR-4 Task 10, plan G12) and its locale, read the
  // account layout's own way — billingVerdictFor is cached per request, so
  // this is the SAME read the layout already made on this navigation.
  const [billing, account, verdict, prefs] = await Promise.all([
    readAccountBilling(accountId),
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle().then(({ data, error }) => {
      if (error) throw new Error(`billing page: account read failed: ${error.message}`);
      return data as { timezone: string | null; language: "en" | "es" | null } | null;
    }),
    billingVerdictFor(accountId),
    getPersonPrefs(),
  ]);
  const locale = requestLocale({ account, isOperator: isAgency, userLanguage: prefs.language });
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
  const view = billingCardView({ billing, link: null, plan, activePlans: [], used, zone, now, defaultEmail: "",
    // Inert here: no plans are passed, so no action is offered on this page.
    stripeReady: true, webhookReady: true });
  // A first payment still going through: the client's word, shown to whoever
  // opens this page, the agency included (it sees the client's page as the
  // client does). The agency's own card on Settings keeps "Payment failed".
  // client-status.ts says why.
  const processing = billing.subscriptionStatus === "incomplete";
  const t = processing ? PAYMENT_PROCESSING : BILLING_STATUS_TREATMENTS[view.status];
  // An ended plan (design review I4): the help never asks for a card, whether the plan reads canceled
  // or its pause says so; and "contact us" has a target — the agency's support address, read here on
  // the server, else the line names who to ask.
  const ended = view.status === "canceled" || (verdict.paused && verdict.cause === "ended");
  const support = normalizeReplyTo(process.env.AGENCY_SUPPORT_EMAIL) ?? null;
  const pausedLine = verdict.paused ? pausedSentence(verdict.cause === "ended" ? "ended" : "payment", support, locale) : null;

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
            {pausedLine ? <p className="text-sm text-foreground" lang={locale}>{pausedLine}</p> : null}
            {!billing.complimentary && billing.stripeCustomerId ? (
              <ManageBillingButton
                open={openBillingPortalAction.bind(null, accountId)}
                help={ended ? m["billing.page.manageHelp.canceled"] : m["billing.page.manageHelp"]}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** The paused line (plan G12; design review I4): an ended plan's "contact us" is a mailto link to the
 *  agency's support address when one is set, else names the team that set up the account. */
function pausedSentence(cause: "payment" | "ended", support: string | null, locale: Locale): React.ReactNode {
  if (cause === "payment") return tFn(m, "billing.page.paused.payment", locale);
  if (!support) return tFn(m, "billing.page.paused.endedNoContact", locale);
  const [before, after] = tFn(m, "billing.page.paused.ended", locale).split("{email}");
  return (
    <>
      {before}
      <a href={`mailto:${support}`} className="underline underline-offset-2">{support}</a>
      {after}
    </>
  );
}
