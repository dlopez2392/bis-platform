import type { SupabaseClient } from "@supabase/supabase-js";
import type { CasOutcome } from "./documents";

/**
 * Item 8a-1 (spec 3.1, 3.3, 3.6): the reads and writes behind apps/web/src/lib/ai/gateway.ts and the
 * agency's AI card. The two RPCs are 0086's security definer functions (service_role only), so the
 * gateway's caller passes a service client; the card's reads run on the agency's REQUEST client
 * (0086 lets the agency alone SELECT all three tables). Nothing here takes or returns a prompt or a
 * model's output: the ledger has no column for either.
 */
export const AI_FEATURES = ["call_summary", "call_proposals", "call_card", "record_summary"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_OUTCOMES = ["ok", "global_off", "account_off", "over_budget", "unknown_model", "gate_unreadable", "no_key", "timeout", "provider_error"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

export const DEFAULT_MONTHLY_BUDGET_CENTS = 1000;
export const MAX_MONTHLY_BUDGET_CENTS = 100000;

export type AiGate = { globalEnabled: boolean; accountEnabled: boolean; budgetMicroUsd: number; monthSpendMicroUsd: number; recordSummariesToday: number };
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export async function aiGateCheck(db: SupabaseClient, a: { accountId: string; monthKey: string; dayKey: string; signal?: AbortSignal }): Promise<AiGate> {
  let q = db.rpc("ai_gate_check", { p_account: a.accountId, p_month: a.monthKey, p_day: a.dayKey });
  if (a.signal) q = q.abortSignal(a.signal);
  const { data, error } = await q;
  if (error) throw new Error(`aiGateCheck failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (r === null || typeof r !== "object" || typeof r.global_enabled !== "boolean" || typeof r.account_enabled !== "boolean"
      || !isCount(r.budget_microusd) || !isCount(r.month_spend_microusd) || !isCount(r.record_summaries_today)) {
    throw new Error("aiGateCheck: unexpected answer");
  }
  return {
    globalEnabled: r.global_enabled, accountEnabled: r.account_enabled, budgetMicroUsd: r.budget_microusd,
    monthSpendMicroUsd: r.month_spend_microusd, recordSummariesToday: r.record_summaries_today,
  };
}

export type AiLedgerEntry = {
  accountId: string; feature: AiFeature; model: string; inputTokens: number | null; outputTokens: number | null;
  costMicroUsd: number; outcome: AiOutcome; latencyMs: number; monthKey: string; dayKey: string;
};

/**
 * One ledger row and the account's counters, in one server transaction. THROWS on an error or an aborted
 * signal. A timeout (or any abort) does NOT mean the row was not written: the request may already have
 * reached the database, which can still commit it after the client gave up. Never retry a failed call:
 * a retry can write the row twice and count the cost twice. Log the failure and move on.
 */
export async function recordAiLedger(db: SupabaseClient, r: AiLedgerEntry & { signal?: AbortSignal }): Promise<void> {
  let q = db.rpc("ai_ledger_record", {
    p_account: r.accountId, p_feature: r.feature, p_model: r.model, p_in: r.inputTokens, p_out: r.outputTokens,
    p_cost: r.costMicroUsd, p_outcome: r.outcome, p_latency: r.latencyMs, p_month: r.monthKey, p_day: r.dayKey,
  });
  if (r.signal) q = q.abortSignal(r.signal);
  const { error } = await q;
  if (error) throw new Error(`recordAiLedger failed: ${error.message}`);
}

export type AiSettingsRead = { accountEnabled: boolean; monthlyBudgetCents: number; monthKey: string | null; monthSpendMicroUsd: number; globalEnabled: boolean; dayKey: string | null; recordSummariesToday: number };

/** The card's read. No account row means the defaults; no global row reads OFF, as the gate does. */
export async function getAiSettings(db: SupabaseClient, accountId: string): Promise<AiSettingsRead> {
  const [acct, global] = await Promise.all([
    db.from("account_ai_settings").select("enabled, monthly_budget_cents, month_key, month_spend_microusd, day_key, record_summaries_today").eq("account_id", accountId).maybeSingle(),
    db.from("ai_gateway_settings").select("enabled").eq("id", true).maybeSingle(),
  ]);
  if (acct.error) throw new Error(`getAiSettings: account read failed: ${acct.error.message}`);
  if (global.error) throw new Error(`getAiSettings: global read failed: ${global.error.message}`);
  const a = acct.data as { enabled: boolean; monthly_budget_cents: number; month_key: string | null; month_spend_microusd: number | string; day_key: string | null; record_summaries_today: number } | null;
  const g = global.data as { enabled: boolean } | null;
  return {
    accountEnabled: a?.enabled ?? true,
    monthlyBudgetCents: a?.monthly_budget_cents ?? DEFAULT_MONTHLY_BUDGET_CENTS,
    monthKey: a?.month_key ?? null,
    monthSpendMicroUsd: Number(a?.month_spend_microusd ?? 0),
    globalEnabled: g?.enabled ?? false,
    dayKey: a?.day_key ?? null,
    recordSummariesToday: a?.record_summaries_today ?? 0,
  };
}

export async function countAiSkipsSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number> {
  const { count, error, status } = await db.from("ai_ledger").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).in("outcome", ["global_off", "account_off", "over_budget"]).gte("created_at", sinceIso);
  // A HEAD answer has no body, so error.message is often empty: the code and the HTTP status say what failed.
  if (error) throw new Error(`countAiSkipsSince failed: ${error.message} (code ${error.code}, HTTP ${status})`);
  // memory "Head-count null": a failed head count can come back { count: null, error: null }.
  if (count === null) throw new Error("countAiSkipsSince: no count");
  return count;
}

export async function firstOverBudgetSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<string | null> {
  const { data, error } = await db.from("ai_ledger").select("created_at")
    .eq("account_id", accountId).eq("outcome", "over_budget").gte("created_at", sinceIso)
    .order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error(`firstOverBudgetSince failed: ${error.message}`);
  return (data?.[0] as { created_at: string } | undefined)?.created_at ?? null;
}

/**
 * The card's Save (and its Undo). Writes exactly these columns, so the counters ai_ledger_record keeps are never reset.
 * A Save passes no `expected` and upserts. An Undo passes `expected` = what its own Save wrote and becomes a
 * compare-and-set (the repo's Undo convention, documents.ts's CasOutcome): it updates only while the row still holds
 * exactly that, never inserts, and answers "changed" when someone wrote after the Save, so it never clobbers them.
 */
export async function setAccountAiSettings(
  db: SupabaseClient, accountId: string, s: { enabled: boolean; monthlyBudgetCents: number; actorId: string },
  expected?: { enabled: boolean; monthlyBudgetCents: number },
): Promise<CasOutcome> {
  const values = { enabled: s.enabled, monthly_budget_cents: s.monthlyBudgetCents, updated_by: s.actorId, updated_at: new Date().toISOString() };
  if (expected) {
    const { data, error } = await db.from("account_ai_settings").update(values)
      .eq("account_id", accountId).eq("enabled", expected.enabled).eq("monthly_budget_cents", expected.monthlyBudgetCents)
      .select("account_id");
    if (error) throw new Error(`setAccountAiSettings failed: ${error.message}`);
    return (data ?? []).length > 0 ? "updated" : "changed";
  }
  const { error } = await db.from("account_ai_settings").upsert({ account_id: accountId, ...values }, { onConflict: "account_id" });
  if (error) throw new Error(`setAccountAiSettings failed: ${error.message}`);
  return "updated";
}

/**
 * The switch for every account. With `expected` (an Undo: the state its own action wrote) it is a compare-and-set
 * that answers "changed" when the row moved on; without it, a missing row throws (the row is seeded by 0086).
 */
export async function setGlobalAiEnabled(db: SupabaseClient, s: { enabled: boolean; actorId: string }, expected?: boolean): Promise<CasOutcome> {
  let q = db.from("ai_gateway_settings")
    .update({ enabled: s.enabled, updated_by: s.actorId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (expected !== undefined) q = q.eq("enabled", expected);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`setGlobalAiEnabled failed: ${error.message}`);
  if (expected !== undefined) return (data ?? []).length === 1 ? "updated" : "changed";
  if (!data || data.length !== 1) throw new Error("setGlobalAiEnabled: the switch row is missing");
  return "updated";
}
