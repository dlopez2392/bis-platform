import { describe, it, expect } from "vitest";
import { getSmsProvider } from "./index";

// THE test of this task. A provider that delivers outside production is an
// unrecallable text to a real person.
describe("getSmsProvider", () => {
  it("is FAKE unless BOTH VERCEL_ENV and NODE_ENV say production", () => {
    // NODE_ENV is "test" under vitest, so every combination here must be fake
    // — including the one that fakes the spoofable half.
    expect(getSmsProvider({ VERCEL_ENV: "production", TELNYX_API_KEY: "k" }).isFake).toBe(true);
    expect(getSmsProvider({ VERCEL_ENV: "preview", TELNYX_API_KEY: "k" }).isFake).toBe(true);
    expect(getSmsProvider({}).isFake).toBe(true);
  });

  it("uses the real provider with a redirect when one is configured", () => {
    const p = getSmsProvider({ TELNYX_API_KEY: "k", SMS_DEV_REDIRECT_TO: "+15550001111" });
    expect(p.isFake).toBe(false);
    expect(p.redirectTo).toBe("+15550001111");
  });

  it("falls back to fake when a redirect is set with no key", () => {
    expect(getSmsProvider({ SMS_DEV_REDIRECT_TO: "+15550001111" }).isFake).toBe(true);
  });
});
