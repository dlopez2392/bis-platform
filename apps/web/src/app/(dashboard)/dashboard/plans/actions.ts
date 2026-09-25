"use server";

/**
 * Writes from the agency Plans page (/dashboard/plans).
 *
 * Agency-only: `requireAgency()` is the FIRST line of every action, before
 * any parse, read or Stripe call. It redirects a client, which is the right
 * shape: there is no account in scope to soften the answer with.
 *
 * Writes go through serviceDb(), and only after requireAgency(): 0051 grants
 * `authenticated` SELECT on plans and nothing more, so an RLS-scoped write
 * would fail for everyone, agency included. `updated_at` is never set here:
 * `plans` has no trigger, and updatePlan/setPlanArchived set it themselves.
 *
 * ORDER, and why. Stripe FIRST, then ONE database write. If Stripe fails,
 * nothing is written and the row still describes the Stripe objects that
 * exist. If the database write fails after Stripe succeeded, the objects are
 * orphans in Stripe. A retry with the SAME terms (within Stripe's ~24h key
 * window) replays them, because syncPlanToStripe's idempotency keys cover
 * every parameter each call sends; a retry with DIFFERENT terms makes new
 * objects and leaves the first ones orphaned, which is accepted (nothing
 * customer-facing points at them). The reverse order would leave a plan row
 * pointing at prices that do not exist, which step 3 would then try to
 * subscribe a client to.
 *
 * No revalidatePath: the page is force-dynamic, and the islands call
 * router.refresh() (the numbers inventory's reasoning).
 */

import {
  serviceDb, listPlans, getPlan, insertPlan, updatePlan, setPlanArchived,
  METER_KEYS, type Plan, type PlanWrite,
} from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { billingGatewayFromEnv } from "@/lib/billing/stripe-gateway";
import { syncPlanToStripe } from "@/lib/billing/stripe-catalog";
import { parsePlanForm } from "@/lib/billing/plan-form";
import { m } from "@/lib/messages";

export type PlanActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string): PlanActionResult => ({ ok: false, error });

/** Whether the stored row holds EXACTLY this write: every term and every
 *  Stripe id. Field by field, so a key added to a type later is a compile
 *  error here only if it is read, never a silent pass. */
function rowHolds(row: Plan, w: PlanWrite): boolean {
  const t = w.terms;
  return row.name === t.name
    && row.monthlyPriceCents === t.monthlyPriceCents
    && row.features.voice_receptionist === t.features.voice_receptionist
    && row.features.web_concierge === t.features.web_concierge
    && METER_KEYS.every((k) => row.allowances[k] === t.allowances[k] && row.overageCents[k] === t.overageCents[k])
    && row.stripeProductId === w.stripeProductId
    && row.stripePriceIds.base === w.stripePriceIds.base
    && METER_KEYS.every((k) => row.stripePriceIds[k] === w.stripePriceIds[k]);
}

/**
 * `draftId` is minted by the dialog once per new plan and reused by every
 * retry of that dialog's Save. It becomes the row's id and part of every
 * Stripe idempotency key, so a double click or a retried request with the
 * same terms lands on one plan and one set of Stripe objects, not two.
 *
 * A retry whose insert reports `id_taken` is success ONLY when the stored
 * row holds exactly what this call just synced (a true replay). A first
 * Save can land with its response lost; if the user then edits the name
 * and retries, Stripe makes a second product (new name, new key) and the
 * database keeps the first. Claiming "saved" there would tell them their
 * new name stuck when it did not, so they are told it was already saved
 * and to reload.
 */
export async function createPlanAction(draftId: string, formData: FormData): Promise<PlanActionResult> {
  await requireAgency();
  if (!UUID.test(draftId)) return fail(m["plans.error.reload"]);
  const parsed = parsePlanForm(formData);
  if (!parsed.ok) return fail(parsed.error);
  const stripe = billingGatewayFromEnv();
  if (!stripe.ok) {
    console.error(`createPlanAction: Stripe not usable (${stripe.reason})`);
    return fail(m["plans.error.stripeNotConnected"]);
  }

  const db = serviceDb();
  try {
    const plans = await listPlans(db);
    // Checked before Stripe, so a clash makes no Stripe objects. The draft's
    // own row (a retry after a save that did land) is not a clash.
    if (plans.some((p) => p.name === parsed.terms.name && p.id !== draftId)) return fail(m["plans.error.nameTaken"]);
  } catch (e) {
    console.error(`createPlanAction: plan read failed: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }

  let synced;
  try {
    synced = await syncPlanToStripe(stripe.gateway, draftId, parsed.terms, null);
  } catch (e) {
    console.error(`createPlanAction: Stripe refused plan ${draftId}: ${String(e)}`);
    return fail(m["plans.error.stripeFailed"]);
  }

  const write: PlanWrite = { terms: parsed.terms, stripeProductId: synced.productId, stripePriceIds: synced.priceIds };
  try {
    const r = await insertPlan(db, { id: draftId, ...write });
    if (!r.ok && r.reason === "name_taken") return fail(m["plans.error.nameTaken"]);
    if (!r.ok) {
      const stored = await getPlan(db, draftId);
      if (!stored || !rowHolds(stored, write)) {
        console.error(`createPlanAction: draft ${draftId} was already saved with other terms or Stripe ids; this retry's Stripe objects are orphans`);
        return fail(m["plans.error.alreadySaved"]);
      }
    }
  } catch (e) {
    console.error(`createPlanAction: insert failed for ${draftId} (Stripe objects exist; a same-terms retry replays them): ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
  return { ok: true };
}

/**
 * `expectedUpdatedAt` is the version the dialog was opened on. It is checked
 * BEFORE Stripe (so a stale edit makes no prices) and again in the write
 * (updatePlan's optimistic filter closes the race after the check).
 *
 * It is an OPAQUE string, compared and passed on exactly as received. The
 * database returns `updated_at` with MICROSECONDS, and a never-edited plan's
 * comes from `now()`, so it carries them: re-serialising it through `Date`
 * truncates to milliseconds, and `.eq("updated_at", …)` would then never
 * match, turning every never-edited plan permanently "stale".
 */
export async function updatePlanAction(
  planId: string, expectedUpdatedAt: string, formData: FormData,
): Promise<PlanActionResult> {
  await requireAgency();
  if (!UUID.test(planId) || !expectedUpdatedAt) return fail(m["plans.error.reload"]);
  const parsed = parsePlanForm(formData);
  if (!parsed.ok) return fail(parsed.error);
  const stripe = billingGatewayFromEnv();
  if (!stripe.ok) {
    console.error(`updatePlanAction: Stripe not usable (${stripe.reason})`);
    return fail(m["plans.error.stripeNotConnected"]);
  }

  const db = serviceDb();
  let current: Plan | null;
  let plans: Plan[];
  try {
    [current, plans] = await Promise.all([getPlan(db, planId), listPlans(db)]);
  } catch (e) {
    console.error(`updatePlanAction: plan read failed for ${planId}: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
  if (!current) return fail(m["plans.error.notFound"]);
  if (current.archivedAt) return fail(m["plans.error.archived"]);
  if (current.updatedAt !== expectedUpdatedAt) return fail(m["plans.error.stale"]);
  if (plans.some((p) => p.id !== planId && p.name === parsed.terms.name)) return fail(m["plans.error.nameTaken"]);

  let synced;
  try {
    synced = await syncPlanToStripe(stripe.gateway, planId, parsed.terms, {
      terms: current, productId: current.stripeProductId, priceIds: current.stripePriceIds,
    });
  } catch (e) {
    console.error(`updatePlanAction: Stripe refused plan ${planId}: ${String(e)}`);
    return fail(m["plans.error.stripeFailed"]);
  }

  try {
    const r = await updatePlan(db, planId, expectedUpdatedAt, {
      terms: parsed.terms, stripeProductId: synced.productId, stripePriceIds: synced.priceIds,
    });
    if (!r.ok) return fail(r.reason === "stale" ? m["plans.error.stale"] : m["plans.error.nameTaken"]);
  } catch (e) {
    console.error(`updatePlanAction: update failed for ${planId}: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
  return { ok: true };
}

export async function archivePlanAction(planId: string): Promise<PlanActionResult> {
  await requireAgency();
  return setArchived(planId, true);
}

export async function restorePlanAction(planId: string): Promise<PlanActionResult> {
  await requireAgency();
  return setArchived(planId, false);
}

/** Archive is BIS-only (G7): it hides the plan from new assignments and
 *  touches nothing at Stripe, so it is reversible and runs immediately with
 *  an undo toast (DESIGN.md rule 6). */
async function setArchived(planId: string, archived: boolean): Promise<PlanActionResult> {
  if (!UUID.test(planId)) return fail(m["plans.error.reload"]);
  try {
    return (await setPlanArchived(serviceDb(), planId, archived)) ? { ok: true } : fail(m["plans.error.notFound"]);
  } catch (e) {
    console.error(`setArchived(${archived}) failed for ${planId}: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
}
