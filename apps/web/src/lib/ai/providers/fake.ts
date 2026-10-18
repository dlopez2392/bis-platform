import { createHash } from "node:crypto";
import type { Provider } from "./types";

export const FAKE_USAGE = { promptTokens: 100, completionTokens: 20 } as const;

/**
 * Spec 8.1: answers with no network call. Plain text names the language and a short hash of the request;
 * in JSON mode it answers JSON that every JSON caller reads as "nothing" (no proposals, no card reading).
 * Selected only by AI_PROVIDER=fake, and never in production (select.ts).
 */
export const fakeProvider: Provider = {
  async complete(req) {
    const hash = createHash("sha256").update(JSON.stringify(req.messages)).digest("hex").slice(0, 8);
    const text = req.responseFormat?.type === "json_object"
      ? JSON.stringify({ proposals: [], reason: null, quote: null, fake: hash })
      : `[fake ${req.language ?? "en"}] ${hash}`;
    return { kind: "ok", text, ...FAKE_USAGE };
  },
};
