import type { AiFeature } from "@bis/db";
import { CONCIERGE_MAX_REPLY_TOKENS } from "@/lib/concierge/guards";
import type { PricedModel } from "./prices";

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
 * its own model. No task has one today: this table changes routing, not behaviour.
 *
 * `feature` is the ledger's name for the task (ai_ledger.feature). The web chat has none YET: 0086's check
 * constraint admits only the four below, so its row could not be written. Until a migration adds 'web_chat', the
 * web chat honours the kill switch, the account's switch and its budget, but its own cost is not on the ledger.
 *
 * Not here: the realtime voice model and its transcription (voice/session-config.ts), a separate lane, and the
 * corpus script's phone fallback (voice/modules/corpus-lib.ts), which plays the phone, not a text task.
 */
export type ModelParams = {
  /** The output-token cap, and the request field that carries it (gpt-4o-mini: max_tokens; a reasoning model
   *  takes max_completion_tokens). Absent: no cap is sent. */
  maxOutput?: { field: "max_tokens" | "max_completion_tokens"; tokens: number };
  /** Sent as reasoning_effort. Reasoning models only. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  /** Sent as response_format. The callers that ask for it parse JSON with no fallback of their own, and
   *  without it gpt-4o-mini routinely wraps JSON in a code fence. */
  responseFormat?: { type: "json_object" };
};
export type ModelRoute = { model: PricedModel; params: ModelParams };
export type TaskRoute = { feature: AiFeature | null; primary: ModelRoute; fallback?: ModelRoute };

export const AI_TASK_NAMES = ["web_chat", "call_summary", "call_card", "call_proposals", "record_summary"] as const;
export type AiTask = (typeof AI_TASK_NAMES)[number];

export const AI_TASKS: Readonly<Record<AiTask, TaskRoute>> = {
  /** The website chat's reply and its capture follow-up (api/concierge/[publicId]/turn). The cap is I2's:
   *  every reply is replayed into every later turn (concierge/guards.ts). */
  web_chat: {
    feature: null,
    primary: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: CONCIERGE_MAX_REPLY_TOKENS } } },
  },
  /** The staff-facing summary of a call (voice/summary-service.ts). No cap: it has a fact-line fallback. */
  call_summary: { feature: "call_summary", primary: { model: "gpt-4o-mini", params: {} } },
  /** The call card's reason and quote (voice/call-card.ts). */
  call_card: {
    feature: "call_card",
    primary: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 300 }, responseFormat: { type: "json_object" } } },
  },
  /** Suggestions from a call (proposals/generate.ts). The cap bounds a runaway proposals array (its fix-wave Minor 6). */
  call_proposals: {
    feature: "call_proposals",
    primary: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 2000 }, responseFormat: { type: "json_object" } } },
  },
  /** The record page's paragraph (contacts/[contactId]/ai-summary). */
  record_summary: {
    feature: "record_summary",
    primary: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 400 } } },
  },
};
