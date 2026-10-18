import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  aiGateCheck, recordAiLedger, getAiSettings, setAccountAiSettings, setGlobalAiEnabled,
  countAiSkipsSince, firstOverBudgetSince, AI_FEATURES, AI_OUTCOMES, type AiLedgerEntry,
} from "../ai-gateway";

/** Item 8a-1 (spec 3.1, 3.3, 3.6): the wrappers over 0086, through PostgREST, on the service client. */
const KEYS = { monthKey: "2026-10", dayKey: "2026-10-18" };
const entry = (accountId: string, o: Partial<AiLedgerEntry> = {}): AiLedgerEntry => ({
  accountId, feature: "call_summary", model: "gpt-4o-mini", inputTokens: 100, outputTokens: 20,
  costMicroUsd: 27, outcome: "ok", latencyMs: 5, ...KEYS, ...o,
});

describe("aiGateCheck / recordAiLedger", () => {
  it("a fresh account reads the defaults, in numbers (assumption A3; mutation: return budget_microusd as String(...) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      expect(await aiGateCheck(db, { accountId, ...KEYS })).toEqual({
        globalEnabled: true, accountEnabled: true, budgetMicroUsd: 10_000_000, monthSpendMicroUsd: 0, recordSummariesToday: 0,
      });
    }));

  it("a recorded call is in this month's spend (mutation: pass p_cost: 0 in recordAiLedger -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await recordAiLedger(db, entry(accountId, { costMicroUsd: 720 }));
      await recordAiLedger(db, entry(accountId, { feature: "record_summary", costMicroUsd: 600 }));
      expect(await aiGateCheck(db, { accountId, ...KEYS })).toMatchObject({ monthSpendMicroUsd: 1320, recordSummariesToday: 1 });
      const { data } = await db.from("ai_ledger").select("feature, input_tokens, output_tokens, cost_microusd, outcome").eq("account_id", accountId).order("cost_microusd");
      expect(data).toEqual([
        { feature: "record_summary", input_tokens: 100, output_tokens: 20, cost_microusd: 600, outcome: "ok" },
        { feature: "call_summary", input_tokens: 100, output_tokens: 20, cost_microusd: 720, outcome: "ok" },
      ]);
    }));

  it("an aborted signal rejects instead of waiting (assumption A1; mutation: drop the .abortSignal(signal) line -> resolves -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await expect(aiGateCheck(db, { accountId, ...KEYS, signal: AbortSignal.abort() })).rejects.toThrow();
      await expect(recordAiLedger(db, { ...entry(accountId), signal: AbortSignal.abort() })).rejects.toThrow();
    }));

  it("an answer of the wrong shape throws, never reads as open (mutation: drop the shape check -> FAILS)", async () => {
    const builder = {
      abortSignal() { return builder; },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: { global_enabled: "yes" }, error: null }).then(ok),
    };
    const odd = { rpc: () => builder } as unknown as SupabaseClient;
    await expect(aiGateCheck(odd, { accountId: "a", ...KEYS })).rejects.toThrow(/unexpected answer/);
  });

  it("every AI_FEATURES and AI_OUTCOMES value is one 0086 accepts, through recordAiLedger (review M5; mutation: add 'chat' to AI_FEATURES or 'maybe' to AI_OUTCOMES -> the check constraint refuses it -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      for (const feature of AI_FEATURES) await recordAiLedger(db, entry(accountId, { feature }));
      for (const outcome of AI_OUTCOMES) await recordAiLedger(db, entry(accountId, { feature: "call_card", outcome }));
      const { count, error } = await db.from("ai_ledger").select("id", { count: "exact", head: true }).eq("account_id", accountId);
      expect([error, count]).toEqual([null, AI_FEATURES.length + AI_OUTCOMES.length]);
    }));
});

describe("the card's reads and writes", () => {
  it("no row reads the defaults; a save is read back and never resets the counters (mutation: add month_spend_microusd: 0 to the upsert -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      expect(await getAiSettings(db, accountId)).toEqual({ accountEnabled: true, monthlyBudgetCents: 1000, monthKey: null, monthSpendMicroUsd: 0, globalEnabled: true });
      await recordAiLedger(db, entry(accountId, { costMicroUsd: 720 }));
      await setAccountAiSettings(db, accountId, { enabled: false, monthlyBudgetCents: 2500, actorId: "user_test" });
      expect(await getAiSettings(db, accountId)).toEqual({ accountEnabled: false, monthlyBudgetCents: 2500, monthKey: "2026-10", monthSpendMicroUsd: 720, globalEnabled: true });
      const { data } = await db.from("account_ai_settings").select("updated_by").eq("account_id", accountId).single();
      expect(data).toEqual({ updated_by: "user_test" });
    }));

  // Review I9: the db suite NEVER writes ai_gateway_settings (one row shared by every account and every
  // concurrent suite on the project). setGlobalAiEnabled and getAiSettings's missing-row answer are proved on a
  // recording stub; the real row's behaviour (seeded on, a missing row reads off) is 0086's withRollback SQL tests.
  function stubDb(answer: { data: unknown; error: { message: string } | null }) {
    const seen: unknown[][] = [];
    const chain = {
      update: (v: unknown) => { seen.push(["update", v]); return chain; },
      eq: (c: string, v: unknown) => { seen.push(["eq", c, v]); return chain; },
      select: (c: string) => { seen.push(["select", c]); return chain; },
      maybeSingle: async () => answer,
      then: (ok: (v: unknown) => unknown) => Promise.resolve(answer).then(ok),
    };
    return { seen, db: { from: (t: string) => { seen.push(["from", t]); return chain; } } as unknown as SupabaseClient };
  }

  it("setGlobalAiEnabled updates exactly the one row by id, as the actor, and refuses when no row was updated (mutations: drop .eq('id', true); drop the length check -> FAILS)", async () => {
    const ok = stubDb({ data: [{ id: true }], error: null });
    await setGlobalAiEnabled(ok.db, { enabled: false, actorId: "user_test" });
    expect(ok.seen.map((x) => x.slice(0, 2))).toEqual([["from", "ai_gateway_settings"], ["update", expect.objectContaining({ enabled: false, updated_by: "user_test" })], ["eq", "id"], ["select", "id"]]);
    expect(ok.seen[2]).toEqual(["eq", "id", true]);
    await expect(setGlobalAiEnabled(stubDb({ data: [], error: null }).db, { enabled: true, actorId: "user_test" })).rejects.toThrow("the switch row is missing");
  });

  it("getAiSettings reads a missing global row as OFF, as the gate does (plan deviation 13; mutation: g?.enabled ?? true -> FAILS)", async () => {
    const none = stubDb({ data: null, error: null });
    expect((await getAiSettings(none.db, "a1")).globalEnabled).toBe(false);
  });

  it("counts this month's skips (off or over budget, never a failed request) and finds the first over-budget row (mutations: .neq('outcome', 'ok') instead of .in(...) -> 4 -> FAILS; order descending -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const refused = { inputTokens: null, outputTokens: null, costMicroUsd: 0 };
      await recordAiLedger(db, entry(accountId));
      await recordAiLedger(db, entry(accountId, { outcome: "account_off", ...refused }));
      await recordAiLedger(db, entry(accountId, { outcome: "provider_error", ...refused }));   // a failure, not a skip: must not count
      await recordAiLedger(db, entry(accountId, { outcome: "over_budget", ...refused }));
      await recordAiLedger(db, entry(accountId, { outcome: "over_budget", ...refused }));
      const since = new Date(Date.now() - 60_000).toISOString();
      expect(await countAiSkipsSince(db, accountId, since)).toBe(3);
      expect(await countAiSkipsSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
      const { data } = await db.from("ai_ledger").select("created_at").eq("account_id", accountId).eq("outcome", "over_budget").order("created_at");
      expect(data).toHaveLength(2);
      expect(await firstOverBudgetSince(db, accountId, since)).toBe(data![0]!.created_at);
    }));
});
