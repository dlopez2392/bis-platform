/**
 * Secrets this repository has published. The repo is public, and CI's e2e job
 * and Playwright's web server run on fixed literal values for several secrets
 * (ci.yml's e2e env, playwright.config.ts's webServer env), each marked by the
 * repo's own convention: the value contains "fixture_only". Anyone can read
 * them, so a production deployment holding one could have its webhooks,
 * links and cron routes forged. In production such a value is REFUSED: it
 * reads as unset, which every guarded point of use already treats as "not
 * configured" and refuses on (a 503, a link not made, a PIN not asked for).
 *
 * VERCEL_ENV alone decides "production" here, unlike the send gates in
 * lib/sms and lib/email, which also need NODE_ENV: those decide whether to
 * DO something, and a spoofed VERCEL_ENV must not make them act. This one only
 * refuses, so a spoofed value can only make it stricter.
 *
 * Every fixture secret given to a running server carries the marker; a new
 * one must too. The one published secret that does not is the Telnyx test
 * public key in ci.yml, and it is not guarded here on purpose: an unset
 * TELNYX_PUBLIC_KEY makes the voice and SMS routes accept UNSIGNED requests,
 * so "treat it as unset" would open them rather than close them.
 */
const FIXTURE_MARK = /fixture_only/i;

export function isFixtureSecret(value: string): boolean {
  return FIXTURE_MARK.test(value);
}

/**
 * `env[name]`, except that in production a published fixture value reads as
 * undefined, with one log line that names the variable and never its value.
 * Logged on every read rather than once: a production secret that is public
 * is an incident, and a line per refused request is how it gets noticed.
 */
export function readSecret(name: string, env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | undefined {
  const value = env[name];
  if (value && env.VERCEL_ENV === "production" && isFixtureSecret(value)) {
    console.error(`${name} holds a test fixture value that is published in this repository; refused in production and treated as unset`);
    return undefined;
  }
  return value;
}
