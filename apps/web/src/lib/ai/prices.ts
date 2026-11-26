/**
 * The one price table (spec 3.5). Integers throughout: micro-dollars, never floats. Each row is AN ESTIMATE the
 * spec labels as such (3.4); correct it here.
 * - gpt-4o-mini: read 2026-10-18 from OpenAI's published price, as last read by this project: $0.15 per million
 *   input tokens and $0.60 per million output tokens.
 * - gpt-6-luna: read 2026-11-26 from OpenAI's pricing page (developers.openai.com/api/docs/pricing, short
 *   context): $0.10 per million input tokens, $0.01 cached input, $0.50 output. The ledger does not split
 *   cached input, so every input token is priced at the full $0.10 (an over-estimate, never an under-one).
 * A model not in this table is refused by the gateway (unknown_model): a cost that cannot be estimated is a
 * cost that cannot be capped.
 */
export const PRICES = {
  "gpt-4o-mini": { inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000 },
  "gpt-6-luna": { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 },
} as const;
export type PricedModel = keyof typeof PRICES;

export type CapField = "max_tokens" | "max_completion_tokens";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

/**
 * What each priced model accepts on the wire, per model and never per call site (the model switch plan's D1,
 * docs/superpowers/plans/2026-11-26-openai-model-switch.md section 4). A task row's params must fit its
 * model's rule: model-rules.test.ts fails on any row whose request body sends a field this table refuses
 * (providers/openai.ts, `refusedBy`). Typed over the price table, so a priced model with no rule does not compile.
 * - `api`: the endpoint. Chat Completions is the only path the provider has.
 * - `capField`: the one field that may carry the output cap; the other is refused.
 * - `reasoningEfforts`: the reasoning_effort values accepted; empty means the field is refused.
 * - `reasoningEffortRequired`: omitting reasoning_effort is refused.
 * - `jsonMode`: response_format json_object is accepted.
 *
 * gpt-6-luna, measured by the spike (run 45887051394, 2026-11-26): max_tokens refused (unsupported_parameter);
 * "minimal" refused; "none" and "low" accepted without tools; WITH tools only "none" is accepted and omitting
 * the effort is refused, so every luna row names one. JSON mode passed 5 of 5.
 */
export type ModelRule = {
  api: "chat";
  capField: CapField;
  reasoningEfforts: readonly ReasoningEffort[];
  reasoningEffortRequired: boolean;
  jsonMode: boolean;
};
export const MODEL_RULES: { readonly [M in PricedModel]: ModelRule } = {
  "gpt-4o-mini": { api: "chat", capField: "max_tokens", reasoningEfforts: [], reasoningEffortRequired: false, jsonMode: true },
  "gpt-6-luna": { api: "chat", capField: "max_completion_tokens", reasoningEfforts: ["none", "low"], reasoningEffortRequired: true, jsonMode: true },
};

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
