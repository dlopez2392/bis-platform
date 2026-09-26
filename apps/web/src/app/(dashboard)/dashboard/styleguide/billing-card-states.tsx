"use client";

import type { AccountBilling, BillingLink, MeterAmounts, Plan } from "@bis/db";
import {
  BillingCard, BillingCardError, BillingCardSkeleton,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-card";
import { billingCardView } from "@/lib/billing/billing-view";

/**
 * The agency's Billing card in every state it can be in. A client component
 * for the same reason settings-field-cards.tsx gives: the card's action props
 * are plain functions, which a server component cannot hand across. Each
 * view is built by the REAL billingCardView from fixture rows, so a specimen
 * shows exactly what Settings would, and nothing here reaches Stripe or the
 * database: every action is a local no-op that answers ok (the dialogs open,
 * and their toasts fire, but nothing is written).
 */
const demoOk = async () => ({ ok: true as const });
const NOW = new Date("2026-10-20T15:00:00Z");
const ZONE = "America/Chicago";

const plan = (id: string, name: string, cents: number, allowances: MeterAmounts): Plan => ({
  id, agencyId: "agency", name, monthlyPriceCents: cents, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true }, allowances,
  overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 }, stripeProductId: "prod_demo",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "", updatedAt: "",
});
const GROWTH = plan("p-growth", "Growth", 14900, { voice_minutes: 500, sms: 1000, ai_chats: 200 });
const PRO = plan("p-pro", "Pro", 29900, { voice_minutes: 1500, sms: 3000, ai_chats: 600 });
const PLANS = [GROWTH, PRO];

const row = (over: Partial<AccountBilling>): AccountBilling => ({
  accountId: "demo", planId: GROWTH.id, complimentary: false, stripeCustomerId: "cus_demo", stripeSubscriptionId: "sub_demo",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00Z", currentPeriodEnd: "2026-11-12T17:00:00Z",
  pastDueSince: null, billingPausedAt: null, billingStartedAt: "2026-09-12T17:00:00Z", createdAt: "", updatedAt: "",
  ...over,
});
const LINK: BillingLink = {
  accountId: "demo", planId: GROWTH.id, stripeCustomerId: "cus_demo", checkoutSessionId: "cs_demo",
  checkoutUrl: "https://checkout.stripe.com/c/pay/cs_demo", sentTo: "owner@rioroofing.test",
  expiresAt: "2026-10-21T15:00:00Z", sentAt: "2026-10-20T14:00:00Z", updatedAt: "",
};
const USED: MeterAmounts = { voice_minutes: 312, sms: 1043, ai_chats: 3 };

function view(billing: AccountBilling | null, opts: { link?: BillingLink; plans?: Plan[]; stripeReady?: boolean } = {}) {
  const plans = opts.plans ?? PLANS;
  return billingCardView({
    billing, link: opts.link ?? null, plan: billing ? plans.find((p) => p.id === billing.planId) ?? null : null,
    activePlans: plans, used: billing ? USED : null, zone: ZONE, now: NOW,
    defaultEmail: "owner@rioroofing.test", stripeReady: opts.stripeReady ?? true,
  });
}

const DEMOS: { label: string; view: ReturnType<typeof view> }[] = [
  { label: "Unbilled — the empty state sells the action", view: view(null) },
  { label: "Link sent — the link line and Copy link", view: view(null, { link: LINK }) },
  { label: "Active — usage against the period, texts over allowance", view: view(row({})) },
  { label: "Payment failed", view: view(row({ subscriptionStatus: "past_due", pastDueSince: "2026-10-13T17:00:00Z" })) },
  { label: "Paused", view: view(row({ subscriptionStatus: "paused" })) },
  { label: "Canceled", view: view(row({ subscriptionStatus: "canceled" })) },
  {
    label: "Complimentary, with a live link out (Copy link stays)",
    view: view(row({ complimentary: true, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null, currentPeriodStart: null, currentPeriodEnd: null }), { link: LINK }),
  },
  { label: "No plans yet", view: view(null, { plans: [] }) },
  { label: "Stripe not connected", view: view(null, { stripeReady: false }) },
];

function Demo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function BillingCardStates() {
  return (
    <div className="flex w-full flex-wrap items-start gap-6">
      {DEMOS.map((d) => (
        <Demo key={d.label} label={d.label}>
          <BillingCard view={d.view} send={demoOk} markComplimentary={demoOk} stopComplimentary={demoOk} changePlan={demoOk} />
        </Demo>
      ))}
      <Demo label="Loading — shaped like the card">
        <BillingCardSkeleton />
      </Demo>
      <Demo label="Error — the rest of Settings still loads">
        <BillingCardError />
      </Demo>
    </div>
  );
}
