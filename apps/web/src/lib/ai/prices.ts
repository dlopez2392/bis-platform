/**
 * The one price table (spec 3.5). Read 2026-11-10 from OpenAI's model page for gpt-6-luna (TEXT_MODEL,
 * models.ts): $0.10 per million input tokens and $0.50 per million output tokens. Cached input ($0.01 per
 * million) is not modelled: every input token is priced as uncached, so the estimate errs high. AN ESTIMATE the
 * spec labels as such (3.4); correct it here. Integers throughout: micro-dollars, never floats.
 * gpt-4o-mini's row ($0.15 / $0.60) was removed with the move to gpt-6-luna: nothing calls it any more, and a
 * stray caller should be refused (unknown_model) rather than sent a reasoning-model body it would reject.
 * A model not in this table is refused by the gateway (unknown_model): a cost that cannot be estimated is a
 * cost that cannot be capped.
 */
export const PRICES = {
  "gpt-6-luna": { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 },
} as const;
export type PricedModel = keyof typeof PRICES;

export function isPricedModel(model: string): model is PricedModel {
  return Object.prototype.hasOwnProperty.call(PRICES, model);
}

/** Whole micro-dollars, rounded UP: ceil(in x input / 1e6 + out x output / 1e6). */
export function costMicroUsd(model: PricedModel, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  return Math.ceil((inputTokens * p.inputMicroUsdPerMTok + outputTokens * p.outputMicroUsdPerMTok) / 1_000_000);
}

/** When an answer reports no usage: a token per four characters, rounded up (an estimate, so a missing field never reads as free). */
export function estimatedTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
