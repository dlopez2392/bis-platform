import type { LanguageModel } from "ai";

/**
 * Which model answers the website assistant, decided by ONE environment
 * variable so the choice is a deploy setting rather than a code change.
 *
 * `ASSISTANT_MODEL` is `provider/model`, e.g. `openai/gpt-4.1-mini` or
 * `deepseek/deepseek-chat`. The default is OpenAI because the platform
 * already carries `OPENAI_API_KEY` for Sofía's Realtime sessions — the
 * assistant costs nobody a new secret. DeepSeek is the model bis-rgv.com's
 * own assistant ran on before it moved here, kept as an option for its price.
 *
 * Returns null when the named provider's key is missing, and the route
 * answers 503 rather than mint a request that would fail at the provider.
 */
export const DEFAULT_ASSISTANT_MODEL = "openai/gpt-4.1-mini";

export type ResolvedModel = { id: string; provider: "openai" | "deepseek"; name: string };

export function resolveModelId(env: NodeJS.ProcessEnv = process.env): ResolvedModel | null {
  const raw = (env.ASSISTANT_MODEL ?? DEFAULT_ASSISTANT_MODEL).trim();
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) return null;
  const provider = raw.slice(0, slash);
  const name = raw.slice(slash + 1);
  if (provider === "openai") return env.OPENAI_API_KEY ? { id: raw, provider, name } : null;
  if (provider === "deepseek") return env.DEEPSEEK_API_KEY ? { id: raw, provider, name } : null;
  return null;
}

/**
 * Lazy provider imports: the route module must stay import-safe during
 * `next build`'s page-data collection, and a provider's factory reads its
 * key at construction time.
 */
export async function assistantModel(env: NodeJS.ProcessEnv = process.env): Promise<LanguageModel | null> {
  const resolved = resolveModelId(env);
  if (!resolved) return null;
  if (resolved.provider === "deepseek") {
    const { createDeepSeek } = await import("@ai-sdk/deepseek");
    return createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY })(resolved.name);
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({ apiKey: env.OPENAI_API_KEY })(resolved.name);
}
