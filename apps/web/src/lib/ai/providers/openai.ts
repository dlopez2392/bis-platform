import { errorName } from "../log";
import type { Provider, ProviderAnswer } from "./types";

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const isTimeout = (e: unknown) => errorName(e) === "TimeoutError" || errorName(e) === "AbortError";
const intOrNull = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * The one provider until study decision 2 (spec 1). OPENAI_API_KEY is read inside the call, never at module
 * scope (summary-service.ts's rule: a missing key at build time must never break the import). A non-ok answer's
 * BODY IS NEVER READ: a provider's 400 can echo the prompt. A thrown error is reduced to its class name.
 */
export const openAiProvider: Provider = {
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
          messages: req.messages,
          ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        }),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (e) {
      return isTimeout(e) ? { kind: "timeout" } : { kind: "provider_error", detail: ` (${errorName(e)})`, promptTokens: null, completionTokens: null };
    }
    if (!r.ok) return { kind: "provider_error", detail: ` HTTP ${r.status}`, promptTokens: null, completionTokens: null };
    let data: unknown;
    try {
      data = await r.json();
    } catch (e) {
      return isTimeout(e) ? { kind: "timeout" } : { kind: "provider_error", detail: " (an answer that did not parse)", promptTokens: null, completionTokens: null };
    }
    const d = data as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
    const promptTokens = intOrNull(d?.usage?.prompt_tokens);
    const completionTokens = intOrNull(d?.usage?.completion_tokens);
    const content = d?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { kind: "provider_error", detail: " (no content in the answer)", promptTokens, completionTokens };
    return { kind: "ok", text: content, promptTokens, completionTokens };
  },
};
