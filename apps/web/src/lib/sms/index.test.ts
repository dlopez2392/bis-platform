import { describe, it, expect, afterEach, vi } from "vitest";
import { getSmsProvider } from "./index";
import { fakeSmsProvider } from "./fake";

// getSmsProvider reads NODE_ENV from the real process env (not from the
// injectable `env` param), so exercising the production branch means
// stubbing the real process.env.NODE_ENV — and restoring it, or every test
// file that runs after this one in the same worker inherits the stub.
afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("uses the real provider only when both signals genuinely say production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const p = getSmsProvider({ VERCEL_ENV: "production", TELNYX_API_KEY: "k" });
    expect(p.isFake).toBe(false);
  });

  it("stays on the fake when VERCEL_ENV=production but NODE_ENV is not production — the `vercel env pull` scenario", () => {
    vi.stubEnv("NODE_ENV", "development");
    const p = getSmsProvider({ VERCEL_ENV: "production", TELNYX_API_KEY: "k" });
    expect(p.isFake).toBe(true);
  });

  it("uses the real provider with a redirect when one is configured", () => {
    const p = getSmsProvider({ TELNYX_API_KEY: "k", SMS_DEV_REDIRECT_TO: "+15550001111" });
    expect(p.isFake).toBe(false);
    expect(p.redirectTo).toBe("+15550001111");
  });

  it("falls back to fake when a redirect is set with no key", () => {
    expect(getSmsProvider({ SMS_DEV_REDIRECT_TO: "+15550001111" }).isFake).toBe(true);
  });

  it("the fake returns a synthetic provider id and sends nothing", async () => {
    const p = fakeSmsProvider();
    const r = await p.send({ to: "+15550001111", from: "+15559998888", body: "hi" });
    expect(r.providerMessageId).toMatch(/^fake_/);
  });
});
