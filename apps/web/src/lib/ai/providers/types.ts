import type { AiMessage } from "../gateway";

export type ProviderRequest = {
  model: string; messages: AiMessage[]; responseFormat?: { type: "json_object" }; maxTokens?: number;
  timeoutMs: number; language?: "en" | "es"; fetchImpl?: typeof fetch;
};
/** Tokens are null when the answer reported none. `detail` is a status or a class name, never text. */
export type ProviderAnswer =
  | { kind: "ok"; text: string; promptTokens: number | null; completionTokens: number | null }
  | { kind: "no_key" }
  | { kind: "timeout" }
  | { kind: "provider_error"; detail: string; promptTokens: number | null; completionTokens: number | null };
export type Provider = { complete(req: ProviderRequest): Promise<ProviderAnswer> };
