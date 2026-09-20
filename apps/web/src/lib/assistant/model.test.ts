import { describe, it, expect } from "vitest";
import { resolveModelId, DEFAULT_ASSISTANT_MODEL } from "./model";

// A literal env, not process.env: the test owns exactly which keys exist.
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("resolveModelId", () => {
  it("defaults to OpenAI when its key is present and nothing is configured", () => {
    expect(resolveModelId(env({ OPENAI_API_KEY: "k" }))).toEqual({
      id: DEFAULT_ASSISTANT_MODEL, provider: "openai", name: "gpt-4.1-mini",
    });
  });
  it("is null — a 503, never a request — when the chosen provider's key is missing", () => {
    expect(resolveModelId(env({}))).toBeNull();
    expect(resolveModelId(env({ ASSISTANT_MODEL: "deepseek/deepseek-chat", OPENAI_API_KEY: "k" }))).toBeNull();
  });
  it("honours ASSISTANT_MODEL for DeepSeek and refuses shapes it does not know", () => {
    expect(resolveModelId(env({ ASSISTANT_MODEL: "deepseek/deepseek-chat", DEEPSEEK_API_KEY: "k" })))
      .toEqual({ id: "deepseek/deepseek-chat", provider: "deepseek", name: "deepseek-chat" });
    expect(resolveModelId(env({ ASSISTANT_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "k" }))).toBeNull();
    expect(resolveModelId(env({ ASSISTANT_MODEL: "anthropic/claude", OPENAI_API_KEY: "k" }))).toBeNull();
    expect(resolveModelId(env({ ASSISTANT_MODEL: "openai/", OPENAI_API_KEY: "k" }))).toBeNull();
  });
});
