import { CreditCard } from "lucide-react";
import { getPlan, serviceDb, sumUsageSince } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccountOwner } from "@/lib/auth";
import { readAccountBilling } from "@/lib/billing/account-billing-read";
import { billingCardView, billingStatusTreatment, safeZone, usagePeriodStart } from "@/lib/billing/billing-view";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { dbForRequest } from "@/lib/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { t as tFn } from "@/lib/i18n/t";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";
import { m } from "@/lib/messages";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { openBillingPortalAction } from "./actions";
import { paymentProcessingTreatment } from "./client-status";
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
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  /** S-10 T9a: the QA override only (`?locale=pseudo`) — off unless
   *  BIS_I18N_QA, never on Vercel (requestPseudoMode's own gate). This page
   *  had no `searchParams` param at all before, so `?locale=pseudo` was
   *  silently inert here even though every string below already resolves
   *  through `locale`. Optional, like team/page.tsx's own `searchParams?`:
   *  every existing caller that renders this page with no query string
   *  (every test in page.test.ts) keeps working unchanged. */
  searchParams?: Promise<{ locale?: string }>;
}) {
  const { accountId } = await params;
  const { locale: localeParam } = (await searchParams) ?? {};
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
  const locale = requestLocale({ account, isOperator: isAgency, userLanguage: prefs.language }, { locale: localeParam });
  // S-10 T9a: `p()` wraps an already-resolved string from the `tFn()` calls
  // below, the same precedent dashboard/page.tsx's own `p()` sets — never a
  // prop threaded through child components, since every string on this page
  // is built right here in the server component.
  const pseudo = requestPseudoMode({ locale: localeParam });
  const p = (resolved: string) => (pseudo ? pseudoLocale(resolved) : resolved);
  const header = <PageHeader title={p(tFn(m, "billing.page.title", locale))} subtitle={p(tFn(m, "billing.page.subtitle", locale))} />;
  if (!billing) {
    // DECISION 4: the item is in the client's nav before billing starts, and
    // this says what will appear here and what makes it appear.
    return (
      <>
        {header}
        <div className="p-6">
          <EmptyState icon={CreditCard} title={p(tFn(m, "billing.page.empty.title", locale))} body={p(tFn(m, "billing.page.empty.body", locale))} />
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
    stripeReady: true, webhookReady: true, locale });
  // A first payment still going through: the client's word, shown to whoever
  // opens this page, the agency included (it sees the client's page as the
  // client does). The agency's own card on Settings keeps "Payment failed".
  // client-status.ts says why.
  const processing = billing.subscriptionStatus === "incomplete";
  const t = processing ? paymentProcessingTreatment(locale) : billingStatusTreatment(view.status, locale);
  // An ended plan (design review I4): the help never asks for a card, whether the plan reads canceled
  // or its pause says so; and "contact us" has a target — the agency's support address, read here on
  // the server, else the line names who to ask.
  const ended = view.status === "canceled" || (verdict.paused && verdict.cause === "ended");
  const support = normalizeReplyTo(process.env.AGENCY_SUPPORT_EMAIL) ?? null;
  const pausedLine = verdict.paused
    ? pausedSentence(verdict.cause === "ended" ? "ended" : "payment", support, locale, pseudo)
    : null;

  return (
    <>
      {header}
      <div className="space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{plan.name}</CardTitle>
            <CardAction><DotPill label={p(t.label)} chip={t.chip} dot={t.dot} data-status={processing ? "payment_processing" : view.status} /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-foreground tabular-nums">
              {billing.complimentary ? p(tFn(m, "billing.page.complimentary", locale)) : view.plan?.price}
            </p>
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-foreground">{p(tFn(m, "billing.page.usage", locale))}</h2>
              <ul className="space-y-1 text-sm tabular-nums text-foreground">
                {view.usage.map((u) => <li key={u.meter} className={u.over ? "font-medium" : undefined}>{p(u.text)}</li>)}
              </ul>
              {view.since ? (
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{p(view.since)}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{p(tFn(m, "billing.usage.chatsNote", locale))}</p>
            </div>
            {view.nextInvoice ? <p className="text-sm text-muted-foreground tabular-nums">{p(view.nextInvoice)}</p> : null}
            {view.status === "canceled" ? <p className="text-sm text-muted-foreground">{p(tFn(m, "billing.page.canceled", locale))}</p> : null}
            {pausedLine ? <p className="text-sm text-foreground" lang={locale}>{pausedLine}</p> : null}
            {!billing.complimentary && billing.stripeCustomerId ? (
              <ManageBillingButton
                open={openBillingPortalAction.bind(null, accountId, locale)}
                help={p(ended ? tFn(m, "billing.page.manageHelp.canceled", locale) : tFn(m, "billing.page.manageHelp", locale))}
                locale={locale}
                pseudo={pseudo}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** The paused line (plan G12; design review I4): an ended plan's "contact us" is a mailto link to the
 *  agency's support address when one is set, else names the team that set up the account.
 *
 *  S-10 T9a: `pseudo` wraps the WHOLE resolved string before any split —
 *  `pseudoLocale` leaves a `{placeholder}` byte-for-byte untouched wherever
 *  it falls, so `.split("{email}")` still finds it inside the padded,
 *  bracketed text and the link lands in the middle of one bracket pair. */
function pausedSentence(cause: "payment" | "ended", support: string | null, locale: Locale, pseudo = false): React.ReactNode {
  const p = (resolved: string) => (pseudo ? pseudoLocale(resolved) : resolved);
  if (cause === "payment") return p(tFn(m, "billing.page.paused.payment", locale));
  if (!support) return p(tFn(m, "billing.page.paused.endedNoContact", locale));
  const [before, after] = p(tFn(m, "billing.page.paused.ended", locale)).split("{email}");
  return (
    <>
      {before}
      <a href={`mailto:${support}`} className="underline underline-offset-2">{support}</a>
      {after}
    </>
  );
}
