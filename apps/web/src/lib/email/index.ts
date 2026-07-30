import { fakeEmailProvider } from "./fake";
import { resendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";

export type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";
export { fakeEmailProvider } from "./fake";

/**
 * Chooses the email provider for the current environment.
 *
 * Production sends for real. EVERYTHING ELSE — local dev, preview deploys,
 * CI, Playwright — gets the fake by default, because this code mails real
 * people and a stray run against a real contact cannot be unsent.
 *
 * The single escape hatch is EMAIL_DEV_REDIRECT_TO, which forces the real
 * provider but rewrites every recipient to that one allowlisted address.
 * There is deliberately no way to send to a contact's real address outside
 * production.
 */
export function getEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const apiKey = env.RESEND_API_KEY ?? "";
  const from = env.EMAIL_FROM ?? "";
  // Both signals are required, not just VERCEL_ENV. `vercel env pull
  // --environment=production` writes VERCEL_ENV="production" AND the real
  // RESEND_API_KEY into a local env file; `next dev` would then load both
  // and this guard would wave a laptop run through as production. NODE_ENV
  // closes that hole because it is read from the real process env here
  // (never from the injectable `env` param above) — Next.js hardcodes
  // NODE_ENV=development under `next dev` and refuses to let a `.env` file
  // override it, so it cannot be pulled or spoofed the way VERCEL_ENV can.
  const isProduction = env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production");
    return resendEmailProvider(apiKey, from);
  }

  const redirectTo = env.EMAIL_DEV_REDIRECT_TO;
  if (redirectTo && apiKey && from) {
    return resendEmailProvider(apiKey, from, redirectTo);
  }

  return fakeEmailProvider();
}
