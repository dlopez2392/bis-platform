import type { SmsProvider } from "./types";
import { fakeSmsProvider } from "./fake";
import { telnyxSmsProvider } from "./telnyx";

type SmsEnv = {
  VERCEL_ENV?: string;
  TELNYX_API_KEY?: string;
  SMS_DEV_REDIRECT_TO?: string;
};

/**
 * Selects the provider. Copied from getEmailProvider (lib/email/index.ts:31)
 * including its reasoning, because the reasoning is the point.
 *
 * Both halves are required. VERCEL_ENV alone is spoofable: someone can put
 * VERCEL_ENV=production and a TELNYX_API_KEY into a local env file and
 * `next dev` would load both, and this guard would wave a laptop run through
 * as production. NODE_ENV closes that hole because it is read from the real
 * process env here (never from the injectable `env` param) — Next hardcodes
 * NODE_ENV=development under `next dev` and refuses to let a `.env` file
 * override it.
 *
 * A stray SMS to a real contact cannot be unsent.
 */
export function getSmsProvider(env: SmsEnv = process.env as SmsEnv): SmsProvider {
  const apiKey = env.TELNYX_API_KEY;
  const isProduction =
    env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!apiKey) throw new Error("TELNYX_API_KEY is required in production");
    return telnyxSmsProvider(apiKey);
  }

  const redirectTo = env.SMS_DEV_REDIRECT_TO;
  if (redirectTo && apiKey) return telnyxSmsProvider(apiKey, redirectTo);

  return fakeSmsProvider();
}
