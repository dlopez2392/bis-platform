import type { SupabaseClient } from "@bis/db";

/**
 * TEST-ONLY. A stand-in for the service client the gateway is handed: its `rpc` records every call and
 * answers ai_gate_check as "open" (or as told) and ai_ledger_record as written (or as failed). It supports
 * the `.abortSignal()` link the wrappers add. Imported by tests only; nothing in the app imports it.
 */
export const OPEN_GATE = {
  global_enabled: true, account_enabled: true, budget_microusd: 10_000_000, month_spend_microusd: 0, record_summaries_today: 0,
};
export type GateRpcCall = { fn: string; args: Record<string, unknown>; signalled: boolean };
export type GateOver = { gate?: Partial<typeof OPEN_GATE> | "error"; ledger?: "error" };

export function gateRpc(over: GateOver = {}): { rpc: (fn: string, args: Record<string, unknown>) => unknown; calls: GateRpcCall[] } {
  const calls: GateRpcCall[] = [];
  const result = (fn: string) => {
    if (fn === "ai_gate_check") {
      return over.gate === "error" ? { data: null, error: { message: "gate unavailable" } } : { data: { ...OPEN_GATE, ...(over.gate ?? {}) }, error: null };
    }
    if (fn === "ai_ledger_record") return over.ledger === "error" ? { data: null, error: { message: "ledger unavailable" } } : { data: null, error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    // `signalled` records whether the caller bounded this RPC with .abortSignal() (review I2).
    const call: GateRpcCall = { fn, args, signalled: false };
    calls.push(call);
    const builder = {
      abortSignal: () => { call.signalled = true; return builder; },
      then: <A, B>(ok?: (v: unknown) => A, no?: (e: unknown) => B) => Promise.resolve(result(fn)).then(ok, no),
    };
    return builder;
  };
  return { rpc, calls };
}

export function openGateDb(over: GateOver = {}): { db: SupabaseClient; calls: GateRpcCall[] } {
  const { rpc, calls } = gateRpc(over);
  return { db: { rpc } as unknown as SupabaseClient, calls };
}
