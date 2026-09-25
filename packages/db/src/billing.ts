import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client billing plans (0051). The ONLY module that touches `plans`.
 *
 * Writes here need serviceDb(): 0051 grants `authenticated` SELECT on plans
 * and nothing more, so the caller is responsible for requireAgency() first
 * (the Plans page's actions do it on their first line).
 */

/** One vocabulary for every meter: allowances, overage, price ids and
 *  usage_events.meter (0051's CHECKs hold the database to it). */
export const METER_KEYS = ["voice_minutes", "sms", "ai_chats"] as const;
export type MeterKey = (typeof METER_KEYS)[number];
export type MeterAmounts = Record<MeterKey, number>;
export type PlanFeatures = { voice_receptionist: boolean; web_concierge: boolean };
export type PlanPriceKey = "base" | MeterKey;
export type StripePriceIds = Record<PlanPriceKey, string>;

/** What the agency types. Money in integer cents. */
export type PlanTerms = {
  name: string;
  monthlyPriceCents: number;
  features: PlanFeatures;
  allowances: MeterAmounts;
  overageCents: MeterAmounts;
};

export type Plan = PlanTerms & {
  id: string;
  agencyId: string;
  currency: "usd";
  stripeProductId: string;
  stripePriceIds: StripePriceIds;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Everything a save writes: the terms and the Stripe objects built for them. */
export type PlanWrite = { terms: PlanTerms; stripeProductId: string; stripePriceIds: StripePriceIds };

type PlanDbRow = {
  id: string; agency_id: string; name: string; monthly_price_cents: number; currency: "usd";
  features: PlanFeatures; allowances: MeterAmounts; overage_cents: MeterAmounts;
  stripe_product_id: string; stripe_price_ids: StripePriceIds;
  archived_at: string | null; created_at: string; updated_at: string;
};

const PLAN_COLUMNS =
  "id, agency_id, name, monthly_price_cents, currency, features, allowances, overage_cents, stripe_product_id, stripe_price_ids, archived_at, created_at, updated_at";

function toPlan(r: PlanDbRow): Plan {
  return {
    id: r.id, agencyId: r.agency_id, name: r.name, monthlyPriceCents: r.monthly_price_cents,
    currency: r.currency, features: r.features, allowances: r.allowances, overageCents: r.overage_cents,
    stripeProductId: r.stripe_product_id, stripePriceIds: r.stripe_price_ids,
    archivedAt: r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toColumns(w: PlanWrite) {
  return {
    name: w.terms.name, monthly_price_cents: w.terms.monthlyPriceCents, features: w.terms.features,
    allowances: w.terms.allowances, overage_cents: w.terms.overageCents,
    stripe_product_id: w.stripeProductId, stripe_price_ids: w.stripePriceIds,
  };
}

/** A 23505 on the name key vs on the primary key; anything else is not ours to name. */
function uniqueViolation(error: { code?: string; message: string }): "name_taken" | "id_taken" | null {
  if (error.code !== "23505") return null;
  if (error.message.includes("plans_agency_name_key")) return "name_taken";
  if (error.message.includes("plans_pkey")) return "id_taken";
  return null;
}

/** Every plan: active ones first, each group by name. */
export async function listPlans(db: SupabaseClient): Promise<Plan[]> {
  const { data, error } = await db.from("plans").select(PLAN_COLUMNS)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listPlans failed: ${error.message}`);
  return ((data ?? []) as PlanDbRow[]).map(toPlan);
}

export async function getPlan(db: SupabaseClient, id: string): Promise<Plan | null> {
  const { data, error } = await db.from("plans").select(PLAN_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`getPlan failed: ${error.message}`);
  return data ? toPlan(data as PlanDbRow) : null;
}

/**
 * Inserts under a CALLER-CHOSEN id (the dialog's draft id), so a retried
 * Save lands on the same row: a second insert of that id is `id_taken`,
 * which the action reports as success. The agency is BIS, row #1, exactly
 * as createAccount and captureBlueprint resolve it.
 */
export async function insertPlan(
  db: SupabaseClient, input: { id: string } & PlanWrite,
): Promise<{ ok: true; plan: Plan } | { ok: false; reason: "name_taken" | "id_taken" }> {
  const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
  if (agErr || !agency) throw new Error(`insertPlan: no agency row: ${agErr?.message ?? "none"}`);
  const { data, error } = await db.from("plans")
    .insert({ id: input.id, agency_id: (agency as { id: string }).id, ...toColumns(input) })
    .select(PLAN_COLUMNS).single();
  if (error) {
    const reason = uniqueViolation(error);
    if (reason) return { ok: false, reason };
    throw new Error(`insertPlan failed: ${error.message}`);
  }
  return { ok: true, plan: toPlan(data as PlanDbRow) };
}

/**
 * Optimistic: writes only while `updated_at` is still what the caller read
 * AND the plan is not archived. Anything else is `stale`: another tab saved,
 * archived, or restored it in between. The action checks this BEFORE calling
 * Stripe too; this is the check that closes the race after it.
 */
export async function updatePlan(
  db: SupabaseClient, id: string, expectedUpdatedAt: string, input: PlanWrite,
): Promise<{ ok: true; plan: Plan } | { ok: false; reason: "stale" | "name_taken" }> {
  const { data, error } = await db.from("plans")
    .update({ ...toColumns(input), updated_at: new Date().toISOString() })
    .eq("id", id).eq("updated_at", expectedUpdatedAt).is("archived_at", null)
    .select(PLAN_COLUMNS).maybeSingle();
  if (error) {
    if (uniqueViolation(error) === "name_taken") return { ok: false, reason: "name_taken" };
    throw new Error(`updatePlan failed: ${error.message}`);
  }
  if (!data) return { ok: false, reason: "stale" };
  return { ok: true, plan: toPlan(data as PlanDbRow) };
}

/** Archive (true) or restore (false). Returns whether a row actually changed,
 *  so a double archive or a restore of an active plan reports false. Bumps
 *  updated_at: an edit dialog opened before the archive is now stale. */
export async function setPlanArchived(db: SupabaseClient, id: string, archived: boolean): Promise<boolean> {
  const now = new Date().toISOString();
  const q = db.from("plans").update({ archived_at: archived ? now : null, updated_at: now }).eq("id", id);
  const { data, error } = await (archived ? q.is("archived_at", null) : q.not("archived_at", "is", null)).select("id");
  if (error) throw new Error(`setPlanArchived failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Billed accounts per plan id (the Plans list's "N clients"). A plan with
 *  none is absent from the record. */
export async function countBilledAccountsByPlan(db: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await db.from("account_billing").select("plan_id");
  if (error) throw new Error(`countBilledAccountsByPlan failed: ${error.message}`);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { plan_id: string }[]) out[r.plan_id] = (out[r.plan_id] ?? 0) + 1;
  return out;
}
