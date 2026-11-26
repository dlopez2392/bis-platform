import type { AiFeature } from "@bis/db";
import { CONCIERGE_MAX_REPLY_TOKENS } from "@/lib/concierge/guards";
import type { CapField, PricedModel, ReasoningEffort } from "./prices";

/**
 * Route by task, not by vendor (November platform review, "A model-agnostic AI layer"). Every TEXT task in the
 * app names its model here and nowhere else; the gateway (gateway.ts) reads the row, so swapping a model is an
 * edit to one row plus its price in prices.ts (the gateway refuses an unpriced model, and `model` is typed to
 * the price table so an unpriced one does not compile).
 *
 * `params` are the request settings that belong to the MODEL, not to the prompt: which field carries the output
 * cap and its value, a reasoning effort (reasoning models only), and JSON mode. The provider turns them into the
 * request body (providers/openai.ts, `modelBodyFields`). A fallback carries its own params, because a different
 * model can need different ones.
 *
 * Fallback: tried ONCE, only when the primary's answer was a provider error the provider marks transient (a
 * network failure, HTTP 408, 429 or 5xx), never on a switch, a budget, a missing key, a timeout or a 4xx that
 * says the request was wrong; within what is left of the caller's time limit; its cost goes on the ledger under
 * its own model. The four internal tasks keep their old gpt-4o-mini row as the fallback until the model switch's
 * PR 6 (docs/superpowers/plans/2026-11-26-openai-model-switch.md): it covers a luna outage, never a refused param.
 *
 * What each model accepts is prices.ts's MODEL_RULES, and model-rules.test.ts fails on a row that sends a field
 * its model refuses (gpt-6-luna: max_completion_tokens, never max_tokens; reasoning_effort "none" or "low",
 * never omitted; the model switch's D1, measured 2026-11-26). Every luna row sends "none": all four tasks
 * passed 5 of 5 on it with no reasoning tokens.
 *
 * `feature` is the ledger's name for the task (ai_ledger.feature): every task's completions and refusals are on the
 * ledger, with their cost, and that cost counts toward the account's month (migration web_chat_ledger admitted
 * 'web_chat'). `gated` says whether the gateway applies the global switch, the account's switch and the budget.
 * The web chat is NOT gated: it honours only the kill switch (AI_GATEWAY_OFF), as the AI settings copy promises
 * operators. Gating it is a copy rewrite and the owner's call, never a side effect of recording its cost.
 *
 * Not here: the realtime voice model and its transcription (voice/session-config.ts), a separate lane, and the
 * corpus script's phone fallback (voice/modules/corpus-lib.ts), which plays the phone, not a text task.
 */
export type ModelParams = {
  /** The output-token cap, and the request field that carries it (gpt-4o-mini: max_tokens; gpt-6-luna takes
   *  max_completion_tokens). Absent: no cap is sent. */
  maxOutput?: { field: CapField; tokens: number };
  /** Sent as reasoning_effort. Reasoning models only. */
  reasoningEffort?: ReasoningEffort;
  /** Sent as response_format. The callers that ask for it parse JSON with no fallback of their own, and
   *  without it gpt-4o-mini routinely wraps JSON in a code fence. */
  responseFormat?: { type: "json_object" };
};
export type ModelRoute = { model: PricedModel; params: ModelParams };
export type TaskRoute = { feature: AiFeature; gated: boolean; primary: ModelRoute; fallback?: ModelRoute };

export const AI_TASK_NAMES = ["web_chat", "call_summary", "call_card", "call_proposals", "record_summary"] as const;
export type AiTask = (typeof AI_TASK_NAMES)[number];

export const AI_TASKS: Readonly<Record<AiTask, TaskRoute>> = {
  /** The website chat's reply and its capture follow-up (api/concierge/[publicId]/turn). The cap is I2's:
   *  every reply is replayed into every later turn (concierge/guards.ts). */
  web_chat: {
    feature: "web_chat",
    gated: false,
    primary: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: CONCIERGE_MAX_REPLY_TOKENS } } },
  },
  /** The staff-facing summary of a call (voice/summary-service.ts). No cap: it has a fact-line fallback. */
  call_summary: {
    feature: "call_summary",
    gated: true,
    primary: { model: "gpt-6-luna", params: { reasoningEffort: "none" } },
    fallback: { model: "gpt-4o-mini", params: {} },
  },
  /** The call card's reason and quote (voice/call-card.ts). */
  call_card: {
    feature: "call_card",
    gated: true,
    primary: { model: "gpt-6-luna", params: { maxOutput: { field: "max_completion_tokens", tokens: 300 }, reasoningEffort: "none", responseFormat: { type: "json_object" } } },
    fallback: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 300 }, responseFormat: { type: "json_object" } } },
  },
  /** Suggestions from a call (proposals/generate.ts). The cap bounds a runaway proposals array (its fix-wave Minor 6). */
  call_proposals: {
    feature: "call_proposals",
    gated: true,
    primary: { model: "gpt-6-luna", params: { maxOutput: { field: "max_completion_tokens", tokens: 2000 }, reasoningEffort: "none", responseFormat: { type: "json_object" } } },
    fallback: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 2000 }, responseFormat: { type: "json_object" } } },
  },
  /** The record page's paragraph (contacts/[contactId]/ai-summary). */
  record_summary: {
    feature: "record_summary",
    gated: true,
    primary: { model: "gpt-6-luna", params: { maxOutput: { field: "max_completion_tokens", tokens: 400 }, reasoningEffort: "none" } },
    fallback: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 400 } } },
  },
};
