// apps/web/src/app/(dashboard)/dashboard/plans/page.tsx
//
// The agency Plans page: what clients pay, what's included, what extra use
// costs. Client billing, rollout step 1. It has no effect on any account:
// nothing is assigned a plan until step 3.
//
// requireAgency() is the literal first line, before any read: the reads
// below are through serviceDb(), and such a read must never be ISSUED on a
// client's behalf. RLS would refuse a client anyway (0051: plans_agency_read).
// This line is the real gate, not the nav: the agency-level nav lists Plans
// whenever it renders without an account, and a client can type the URL
// (page.test.ts pins the order).
import { CreditCard } from "lucide-react";
import { countBilledAccountsByPlan, listPlans, serviceDb } from "@bis/db";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui/notice";
import { requireAgency } from "@/lib/auth";
import { planRowView } from "@/lib/billing/plan-rows";
import { stripeKeyVerdict } from "@/lib/billing/stripe-gateway";
import { m } from "@/lib/messages";
import { archivePlanAction, createPlanAction, restorePlanAction, updatePlanAction } from "./actions";
import { NewPlanButton } from "./plan-dialog";
import { PlansList } from "./plans-list";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  await requireAgency();

  const db = serviceDb();
  // Not swallowed: these two reads ARE the page. A failure reaches the
  // dashboard error boundary rather than rendering a list that is quietly
  // missing plans, or an empty state that says there are none.
  const [plans, counts] = await Promise.all([listPlans(db), countBilledAccountsByPlan(db)]);
  const rows = plans.map((p) => planRowView(p, counts[p.id] ?? 0));

  // Only the key's SHAPE is read here, never Stripe itself: a Stripe outage
  // must not take the list down. A save still fails with its own message.
  // The cast is billingGatewayFromEnv's own (TS2559: ProcessEnv's index
  // signature does not count against an all-optional target).
  const stripe = stripeKeyVerdict(process.env as { STRIPE_SECRET_KEY?: string; VERCEL_ENV?: string });
  const newPlan = <NewPlanButton create={createPlanAction} disabled={!stripe.ok} />;

  return (
    <>
      {/* One primary per view (rule 8): the header carries New plan only when
          the list does; when empty, the empty state carries it instead. */}
      <PageHeader title={m["plans.title"]} subtitle={m["plans.subtitle"]} actions={rows.length > 0 ? newPlan : undefined} />
      <div className="space-y-4 p-6">
        {!stripe.ok ? (
          <Notice tone="warn" className="text-foreground">{m[`plans.stripe.${stripe.reason}`]}</Notice>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState icon={CreditCard} title={m["plans.empty.title"]} body={m["plans.empty.body"]} action={newPlan} />
        ) : (
          <PlansList
            rows={rows} canEdit={stripe.ok}
            update={updatePlanAction} archive={archivePlanAction} restore={restorePlanAction}
          />
        )}
      </div>
    </>
  );
}
