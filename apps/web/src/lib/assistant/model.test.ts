import { describe, it, expect } from "vitest";
import { resolveModelId, DEFAULT_ASSISTANT_MODEL } from "./model";

describe("resolveModelId", () => {
  it("defaults to OpenAI when its key is present and nothing is configured", () => {
    expect(resolveModelId({ OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toEqual({
      id: DEFAULT_ASSISTANT_MODEL, provider: "openai", name: "gpt-4.1-mini",
    });
  });
  it("is null — a 503, never a request — when the chosen provider's key is missing", () => {
    expect(resolveModelId({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveModelId({ ASSISTANT_MODEL: "deepseek/deepseek-chat", OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
  });
  it("honours ASSISTANT_MODEL for DeepSeek and refuses shapes it does not know", () => {
    expect(resolveModelId({ ASSISTANT_MODEL: "deepseek/deepseek-chat", DEEPSEEK_API_KEY: "k" } as NodeJS.ProcessEnv))
      .toEqual({ id: "deepseek/deepseek-chat", provider: "deepseek", name: "deepseek-chat" });
    expect(resolveModelId({ ASSISTANT_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveModelId({ ASSISTANT_MODEL: "anthropic/claude", OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveModelId({ ASSISTANT_MODEL: "openai/", OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
  });
});
