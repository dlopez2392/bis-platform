/**
 * The one price table (spec 3.5). Read 2026-10-18 from OpenAI's published price for gpt-4o-mini, as last
 * read by this project: $0.15 per million input tokens and $0.60 per million output tokens. AN ESTIMATE the
 * spec labels as such (3.4); correct it here. Integers throughout: micro-dollars, never floats.
 * A model not in this table is refused by the gateway (unknown_model): a cost that cannot be estimated is a
 * cost that cannot be capped.
 */
export const PRICES = {
  "gpt-4o-mini": { inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000 },
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
