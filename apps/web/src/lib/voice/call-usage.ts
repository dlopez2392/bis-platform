import { recordCallUsage, type CallUsageInput, type SupabaseClient } from "@bis/db";
import type { CallUsageTotals } from "./call-state";

/**
 * What a call cost BIS at OpenAI: the Realtime price table, the estimate, and the never-throw write of one
 * call's usage (0116 call_usage). BIS's own cost record (owner decision 2026-11-10), independent of client
 * billing (lib/billing/usage.ts).
 *
 * Its own table, NOT lib/ai/prices.ts's PRICES: that table is the text gateway's allow-list, and a Realtime model
 * listed there would become a model the gateway accepts.
 *
 * Micro-dollars per 1M tokens, integers ($32 per 1M tokens is 32_000_000; equally, 32 micro-dollars a token).
 * Read 2026-11-10 from OpenAI's model pages. AN ESTIMATE: correct it here when OpenAI's prices change.
 */
type RealtimePrice = {
  textIn: number; audioIn: number; cachedTextIn: number; cachedAudioIn: number; textOut: number; audioOut: number;
};

const GPT_REALTIME: RealtimePrice = {
  textIn: 4_000_000, audioIn: 32_000_000, cachedTextIn: 400_000, cachedAudioIn: 400_000,
  textOut: 24_000_000, audioOut: 64_000_000,
};

export const REALTIME_PRICES: Readonly<Record<string, RealtimePrice>> = {
  "gpt-realtime": GPT_REALTIME,
  "gpt-realtime-2.1": GPT_REALTIME,
  // Only the audio prices were published for the mini model when this was read. Its text and cached prices
  // are UNKNOWN and estimated at the full-size model's, so the estimate errs high rather than reading as free.
  "gpt-realtime-2.1-mini": { ...GPT_REALTIME, audioIn: 10_000_000, audioOut: 20_000_000 },
};

// The caller-speech transcriber (gpt-4o-mini-transcribe) is NOT priced: no price for it is recorded in this repo,
// so it adds 0 to the estimate. Its tokens or seconds are still stored on the row, so it can be costed later.

export type CostedUsage = Pick<CallUsageTotals,
  "inputTextTokens" | "inputAudioTokens" | "inputCachedTextTokens" | "inputCachedAudioTokens"
  | "outputTextTokens" | "outputAudioTokens">;

/**
 * The call's estimated Realtime cost in whole micro-dollars, rounded UP.
 *
 * ASSUMPTION, unverified on a live call: the cached counts are PART OF the text and audio input counts (the
 * convention OpenAI's usage objects follow elsewhere: cached tokens are a subset of the prompt tokens), so only
 * the remainder is priced at the full input rate. Clamped at 0, so a frame that reports more cached tokens than
 * input never prices negative. The row stores the raw counts, so it can be re-costed if this proves wrong.
 *
 * An unknown model costs 0 and is warned about by name: a cost record that cannot be priced is still worth
 * keeping, and the call is long over by the time this runs.
 */
export function estimateCallCostMicroUsd(model: string, u: CostedUsage): number {
  const p = Object.prototype.hasOwnProperty.call(REALTIME_PRICES, model) ? REALTIME_PRICES[model] : undefined;
  if (!p) {
    console.warn(`call usage: no Realtime price for model "${model}"; its cost is recorded as 0`);
    return 0;
  }
  const textIn = Math.max(0, u.inputTextTokens - u.inputCachedTextTokens);
  const audioIn = Math.max(0, u.inputAudioTokens - u.inputCachedAudioTokens);
  const microUsdTimesMillion =
    textIn * p.textIn + u.inputCachedTextTokens * p.cachedTextIn
    + audioIn * p.audioIn + u.inputCachedAudioTokens * p.cachedAudioIn
    + u.outputTextTokens * p.textOut + u.outputAudioTokens * p.audioOut;
  return Math.ceil(microUsdTimesMillion / 1_000_000);
}

/**
 * The same bound recordUsageSafely puts on a usage_events write (lib/billing/usage.ts), for the same reason:
 * supabase-js has no default query timeout, and this runs inside the request Telnyx's call is still holding.
 */
const CALL_USAGE_WRITE_TIMEOUT_MS = 5_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`call usage write timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unprintable error";
  }
}

/**
 * The only way finishCall writes a call's usage. Best effort and it NEVER throws: the caller has hung up, every
 * other leg has run, and a cost record must not change what finishCall returns. `input` may be a thunk so a throw
 * while building it (the estimate, a bad field) is caught here too. A failure is logged with the call; the row is
 * then simply missing.
 */
export async function recordCallUsageSafely(
  db: SupabaseClient, input: CallUsageInput | (() => CallUsageInput), label: string,
): Promise<void> {
  try {
    const built = typeof input === "function" ? input() : input;
    await withTimeout(recordCallUsage(db, built), CALL_USAGE_WRITE_TIMEOUT_MS);
  } catch (e) {
    console.error(`${label}: call usage not recorded: ${describeError(e)}`);
  }
}
