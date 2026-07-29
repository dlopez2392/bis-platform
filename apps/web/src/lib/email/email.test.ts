import { describe, it, expect } from "vitest";
import { getEmailProvider } from "./index";
import { fakeEmailProvider } from "./fake";

const base = { RESEND_API_KEY: "re_test", EMAIL_FROM: "crm@bis-rgv.com" };

describe("getEmailProvider", () => {
  it("uses the fake when VERCEL_ENV is unset (local dev)", () => {
    const p = getEmailProvider({ ...base } as unknown as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(true);
  });

  it("uses the fake on preview deploys", () => {
    const p = getEmailProvider({ ...base, VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(true);
  });

  it("uses the real provider only in production", () => {
    const p = getEmailProvider({ ...base, VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(false);
  });

  it("allows a real send outside production only when a single recipient is allowlisted", () => {
    const p = getEmailProvider({
      ...base, VERCEL_ENV: "preview", EMAIL_DEV_REDIRECT_TO: "dan@example.com",
    } as unknown as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(false);
    expect(p.redirectTo).toBe("dan@example.com");
  });

  it("the fake returns a synthetic provider id and sends nothing", async () => {
    const p = fakeEmailProvider();
    const r = await p.send({
      to: "someone@example.com", fromName: "Test Co", subject: "s", body: "b",
    });
    expect(r.providerMessageId).toMatch(/^fake_/);
  });
});
