import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFixtureSecret, readSecret } from "./fixture-secrets";
import { cronAuthorized } from "./automations/cron-auth";
import { webhookSecretFromEnv } from "./billing/stripe-gateway";
import { consentTokenSecrets } from "./consent/token";
import { hashPin, pinPepperConfigured } from "./owner-line/secrets";
import { requestToken } from "./document-requests/token";
import { feedSecretConfigured, feedToken } from "./booking/feed-token";

// The literals the repo hands a running server: ci.yml's e2e job env and
// playwright.config.ts's webServer env. Copied here as values, because the
// point is that each one, wherever it came from, is refused in production.
const FIXTURES = [
  "whsec_bis_ci_e2e_fixture_only",
  "bis_ci_e2e_consent_token_fixture_only",
  "bis_ci_e2e_owner_line_pin_pepper_fixture_only",
  "ci_scanner_fixture_only",
  "bis_e2e_scanner_fixture_only",
  "bis_e2e_document_link_fixture_only_0000000000",
  "bis_e2e_calendar_feed_fixture_only_00000000000",
];
const REAL = "kq7Vt0X1nW2pR9sL4mB8cZ3yH6fJ5dA0eG2uT7iO";
const PROD = { VERCEL_ENV: "production" } as const;
const PREVIEW = { VERCEL_ENV: "preview" } as const;

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  vi.unstubAllEnvs();
});
const logged = (): string => errSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");

describe("isFixtureSecret", () => {
  it("recognises every fixture literal the repo gives a running server", () => {
    for (const f of FIXTURES) expect(isFixtureSecret(f), f).toBe(true);
  });

  it("does not take a real-looking secret for a fixture", () => {
    expect(isFixtureSecret(REAL)).toBe(false);
    expect(isFixtureSecret("whsec_" + REAL)).toBe(false);
  });
});

describe("readSecret", () => {
  it("in production, a fixture value reads as unset, and the log names the variable, never the value", () => {
    expect(readSecret("CRON_SECRET", { ...PROD, CRON_SECRET: FIXTURES[0] })).toBeUndefined();
    expect(logged()).toContain("CRON_SECRET");
    expect(logged()).not.toContain(FIXTURES[0]);
  });

  it("outside production the same fixture value is returned as is (CI and Preview run on them)", () => {
    expect(readSecret("CRON_SECRET", { ...PREVIEW, CRON_SECRET: FIXTURES[0] })).toBe(FIXTURES[0]);
    expect(readSecret("CRON_SECRET", { CRON_SECRET: FIXTURES[0] })).toBe(FIXTURES[0]);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("in production, a real value is returned untouched, and an unset one stays unset without a log line", () => {
    expect(readSecret("CRON_SECRET", { ...PROD, CRON_SECRET: ` ${REAL}\n` })).toBe(` ${REAL}\n`);
    expect(readSecret("CRON_SECRET", { ...PROD })).toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled();
  });
});

// Each point of use, in production with a fixture value, refuses exactly as
// it does when the variable is unset; each is paired with the same value
// OUTSIDE production being accepted, so the refusal is the guard's doing and
// not a length floor or a format check.
describe("the guard at each point of use", () => {
  const cronReq = (secret: string) => new Request("https://x.example/api/cron", { headers: { authorization: `Bearer ${secret}` } });

  it("CRON_SECRET: the cron routes answer as unset (503), not ok", () => {
    const v = "bis_ci_cron_fixture_only_0000000000000000";
    expect(cronAuthorized(cronReq(v), { ...PROD, CRON_SECRET: v } as unknown as NodeJS.ProcessEnv)).toBe("unset");
    expect(cronAuthorized(cronReq(v), { ...PREVIEW, CRON_SECRET: v } as unknown as NodeJS.ProcessEnv)).toBe("ok");
    expect(logged()).toContain("CRON_SECRET");
  });

  it("STRIPE_WEBHOOK_SECRET: no signing secret, so the webhook answers 503 and no billing link is offered", () => {
    expect(webhookSecretFromEnv({ ...PROD, STRIPE_WEBHOOK_SECRET: "whsec_bis_ci_e2e_fixture_only" })).toBeNull();
    expect(webhookSecretFromEnv({ ...PREVIEW, STRIPE_WEBHOOK_SECRET: "whsec_bis_ci_e2e_fixture_only" })).toBe("whsec_bis_ci_e2e_fixture_only");
    expect(logged()).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("CONSENT_TOKEN_SECRET and its _PREVIOUS: neither seals nor opens an unsubscribe link", () => {
    const v = "bis_ci_e2e_consent_token_fixture_only";
    expect(consentTokenSecrets({ ...PROD, CONSENT_TOKEN_SECRET: v, CONSENT_TOKEN_SECRET_PREVIOUS: v } as unknown as NodeJS.ProcessEnv))
      .toEqual({ current: null, previous: null });
    expect(consentTokenSecrets({ ...PREVIEW, CONSENT_TOKEN_SECRET: v, CONSENT_TOKEN_SECRET_PREVIOUS: v } as unknown as NodeJS.ProcessEnv))
      .toEqual({ current: v, previous: v });
    expect(logged()).toContain("CONSENT_TOKEN_SECRET_PREVIOUS");
  });

  it("OWNER_LINE_PIN_PEPPER: not configured, so no PIN is asked for and none is hashed", async () => {
    const v = "bis_ci_e2e_owner_line_pin_pepper_fixture_only";
    expect(pinPepperConfigured({ ...PROD, OWNER_LINE_PIN_PEPPER: v } as unknown as NodeJS.ProcessEnv)).toBe(false);
    await expect(hashPin("482916", { ...PROD, OWNER_LINE_PIN_PEPPER: v } as unknown as NodeJS.ProcessEnv)).rejects.toThrow("OWNER_LINE_PIN_PEPPER is not set");
    expect(pinPepperConfigured({ ...PREVIEW, OWNER_LINE_PIN_PEPPER: v } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(logged()).not.toContain(v);
  });

  it("DOCUMENT_LINK_SECRET: no document link can be made", () => {
    vi.stubEnv("DOCUMENT_LINK_SECRET", "bis_e2e_document_link_fixture_only_0000000000");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(requestToken("11111111-1111-4111-8111-111111111111")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => requestToken("11111111-1111-4111-8111-111111111111")).toThrow("DOCUMENT_LINK_SECRET is required");
  });

  it("CALENDAR_FEED_SECRET: not configured, and no feed link can be made", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "bis_e2e_calendar_feed_fixture_only_00000000000");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(feedSecretConfigured()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(feedSecretConfigured()).toBe(false);
    expect(() => feedToken("11111111-1111-4111-8111-111111111111")).toThrow("CALENDAR_FEED_SECRET is required");
  });
});
