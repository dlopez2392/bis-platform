import type { AiMessage, AiTool, AiToolCall } from "../gateway";
import type { ModelParams } from "../tasks";

export type ProviderRequest = {
  model: string; params: ModelParams; messages: AiMessage[];
  /** Function tools the model may call (the web chat's capture_lead), and whether it may call one now. */
  tools?: AiTool[]; toolChoice?: "none";
  timeoutMs: number; language?: "en" | "es"; fetchImpl?: typeof fetch;
};
/**
 * Tokens are null when the answer reported none. `detail` is a status or a class name, never text.
 * `toolCalls` is present only when the request offered tools. `transient` marks a provider error a retry on
 * another model could cure (a network failure, HTTP 408, 429 or 5xx): the gateway's fallback reads it, and
 * nothing else does.
 */
export type ProviderAnswer =
  | { kind: "ok"; text: string; toolCalls?: AiToolCall[]; promptTokens: number | null; completionTokens: number | null }
  | { kind: "no_key" }
  | { kind: "timeout" }
  | { kind: "provider_error"; detail: string; transient: boolean; promptTokens: number | null; completionTokens: number | null };
export type Provider = {
  complete(req: ProviderRequest): Promise<ProviderAnswer>;
  /** Whether this deployment can call the provider at all (its key is set). Read before a caller spends anything. */
  configured(): boolean;
};
