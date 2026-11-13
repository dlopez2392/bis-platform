/**
 * The ONE text model every chat-completions call in this app uses: the website chat (concierge turn route and
 * the corpus runner that plays it), the call summary, the call card, the call proposals and the record summary.
 * The next swap is this line plus a row in prices.ts (the gateway refuses an unpriced model).
 *
 * gpt-4o-mini (snapshot gpt-4o-mini-2024-07-18) is shut down by OpenAI on 2027-01-14; gpt-6-luna is the stated
 * replacement (OpenAI's model page, read 2026-11-10). Not this constant: the realtime voice model
 * (REALTIME_MODEL), its gpt-4o-mini-transcribe setting, and the phone fallback (PHONE_FALLBACK_MODEL).
 */
export const TEXT_MODEL = "gpt-6-luna";

/**
 * The body fields every TEXT_MODEL request carries beside `model` and `messages`.
 *
 * gpt-6-luna is a REASONING model (default effort "medium"). The model page states that Chat Completions
 * supports function calling only with `reasoning_effort: "none"`, and the web chat calls a tool, so "none" is
 * required there; the other calls are short replies too, not reasoning workloads, and "none" keeps them fast.
 *
 * ASSUMPTIONS, not yet confirmed by a real call (they follow OpenAI's earlier reasoning models):
 *  - the model rejects `max_tokens` and takes `max_completion_tokens` instead;
 *  - reasoning tokens count against `max_completion_tokens`, so at a higher effort a 300-500 token cap could
 *    come back empty: another reason the effort stays "none";
 *  - a non-default `temperature` or `top_p` is rejected (no call in this app sends either).
 */
export function textModelParams(maxTokens?: number): { reasoning_effort: "none"; max_completion_tokens?: number } {
  return { reasoning_effort: "none", ...(maxTokens !== undefined ? { max_completion_tokens: maxTokens } : {}) };
}
