import { fakeProvider } from "./fake";
import { openAiProvider } from "./openai";
import type { Provider } from "./types";

/** Spec 6: AI_PROVIDER=fake selects the fake, EXCEPT on production, where a stray value can neither silence AI nor fake its output. */
export function providerFor(env: Record<string, string | undefined>): Provider {
  return env.AI_PROVIDER === "fake" && env.VERCEL_ENV !== "production" ? fakeProvider : openAiProvider;
}
