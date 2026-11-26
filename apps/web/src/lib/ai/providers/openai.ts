import { errorName } from "../log";
import type { AiMessage, AiToolCall } from "../gateway";
import type { ModelParams } from "../tasks";
import { MODEL_RULES, type PricedModel } from "../prices";
import type { Provider, ProviderAnswer } from "./types";

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const isTimeout = (e: unknown) => errorName(e) === "TimeoutError" || errorName(e) === "AbortError";
const intOrNull = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
/** A status another model (or a moment later) could cure. Any other 4xx says this request was wrong. */
const transientStatus = (s: number) => s === 408 || s === 429 || s >= 500;

/**
 * The model's own body fields beside model, messages and tools: the output cap under the field this model
 * takes, and its reasoning effort (tasks.ts). Exported for the corpus script (scripts/sofia-corpus.ts), which
 * plays the web chat with the web chat's own row.
 */
export function modelBodyFields(p: ModelParams): Record<string, unknown> {
  return {
    ...(p.maxOutput ? { [p.maxOutput.field]: p.maxOutput.tokens } : {}),
    ...(p.reasoningEffort ? { reasoning_effort: p.reasoningEffort } : {}),
  };
}

/**
 * The fields of a Chat Completions body that `model`'s rule (prices.ts, MODEL_RULES) refuses, each named so a
 * failure says what to fix: a cap under the other field, a reasoning effort it refuses (or a missing one it
 * requires), JSON mode it lacks. Empty means the body fits. model-rules.test.ts runs it over the body this
 * provider sends for every task row. Not applied at request time: the rows are constants that test already
 * covers, and the model spike (scripts/model-spike-lib.ts) sends refused variants through modelBodyFields on purpose.
 */
export function refusedBy(model: PricedModel, body: Record<string, unknown>): string[] {
  const rule = MODEL_RULES[model];
  const refused: string[] = [];
  for (const f of ["max_tokens", "max_completion_tokens"] as const) if (f in body && f !== rule.capField) refused.push(f);
  if ("reasoning_effort" in body) {
    const effort = body.reasoning_effort;
    if (!rule.reasoningEfforts.some((e) => e === effort)) refused.push(`reasoning_effort ${String(effort)}`);
  } else if (rule.reasoningEffortRequired) refused.push("reasoning_effort (missing)");
  if ("response_format" in body && !rule.jsonMode) refused.push("response_format");
  return refused;
}

/** The gateway's messages in Chat Completions' wire shape. System and user messages pass as they are. */
function wire(m: AiMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.toolCalls) {
    return {
      role: "assistant", content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    };
  }
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  return { role: m.role, content: m.content };
}

type WireCall = { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
const toolCallOf = (c: WireCall): AiToolCall => ({
  id: typeof c?.id === "string" ? c.id : "",
  name: typeof c?.function?.name === "string" ? c.function.name : "",
  arguments: typeof c?.function?.arguments === "string" ? c.function.arguments : null,
});

/**
 * The one provider until study decision 2 (spec 1). OPENAI_API_KEY is read inside the call, never at module
 * scope (summary-service.ts's rule: a missing key at build time must never break the import). A non-ok answer's
 * BODY IS NEVER READ: a provider's 400 can echo the prompt. A thrown error is reduced to its class name.
 *
 * With tools offered (the web chat), an answer that is a tool call carries no text, so a missing or null content
 * answers "" with the calls beside it: the web chat's own reading before it moved here. Without tools, a missing
 * content is still a provider error, as before.
 */
export const openAiProvider: Provider = {
  configured: () => Boolean(process.env.OPENAI_API_KEY),
  async complete(req): Promise<ProviderAnswer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { kind: "no_key" };
    const fetchImpl = req.fetchImpl ?? fetch;
    let r: Response;
    try {
      r = await fetchImpl(OPENAI_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages.map(wire),
          ...(req.params.responseFormat ? { response_format: req.params.responseFormat } : {}),
          ...(req.tools ? { tools: req.tools } : {}),
          ...modelBodyFields(req.params),
          ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
        }),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (e) {
      // A transport failure (DNS, a reset connection) is the provider being unreachable: transient.
      return isTimeout(e) ? { kind: "timeout" } : { kind: "provider_error", detail: ` (${errorName(e)})`, transient: true, promptTokens: null, completionTokens: null };
    }
    if (!r.ok) return { kind: "provider_error", detail: ` HTTP ${r.status}`, transient: transientStatus(r.status), promptTokens: null, completionTokens: null };
    let data: unknown;
    try {
      data = await r.json();
    } catch (e) {
      return isTimeout(e) ? { kind: "timeout" } : { kind: "provider_error", detail: " (an answer that did not parse)", transient: false, promptTokens: null, completionTokens: null };
    }
    const d = data as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
    const promptTokens = intOrNull(d?.usage?.prompt_tokens);
    const completionTokens = intOrNull(d?.usage?.completion_tokens);
    const message = d?.choices?.[0]?.message;
    const content = message?.content;
    if (req.tools) {
      const calls = Array.isArray(message?.tool_calls) ? (message.tool_calls as WireCall[]).map(toolCallOf) : [];
      return { kind: "ok", text: typeof content === "string" ? content : "", toolCalls: calls, promptTokens, completionTokens };
    }
    if (typeof content !== "string") return { kind: "provider_error", detail: " (no content in the answer)", transient: false, promptTokens, completionTokens };
    return { kind: "ok", text: content, promptTokens, completionTokens };
  },
};
