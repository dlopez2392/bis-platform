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
 * one must too. The exception is a Telnyx PUBLIC key, which is a fixed base64
 * value and cannot carry a marker: see `telnyxPublicKey` below.
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

/**
 * Telnyx public keys whose PRIVATE halves are published in this repo, so
 * anyone can sign a request that verifies against them. Today one: ci.yml's
 * e2e TELNYX_PUBLIC_KEY, whose private half e2e/consent-texts.spec.ts builds
 * from a fixed seed. Listed by value because a public key cannot carry the
 * fixture_only marker.
 */
const PUBLISHED_TELNYX_KEYS: ReadonlySet<string> = new Set([
  "lW4zmAKH3ZvWpUaw9UO78RQpX8fUhVcP0vvuEaUxS0w=",
]);

export type TelnyxKey = { kind: "unset" } | { kind: "set"; key: string } | { kind: "refused" };

/**
 * TELNYX_PUBLIC_KEY, trimmed: the ONE read every Telnyx-signed route makes
 * (the TeXML routes and SMS inbound). In production a published key is
 * "refused", NOT unset: an unset key makes the TeXML routes accept UNSIGNED
 * requests (SMS inbound refuses them, 401), so reading it as unset would open
 * the voice path. Every route answers "refused" by refusing the request: 403
 * on the TeXML routes, 401 on SMS inbound. Real Telnyx traffic would not
 * verify against a published key either, so nothing legitimate is lost. One
 * log line per refused request, naming the variable, never the value.
 */
export function telnyxPublicKey(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): TelnyxKey {
  const key = env.TELNYX_PUBLIC_KEY?.trim();
  if (!key) return { kind: "unset" };
  if (env.VERCEL_ENV === "production" && PUBLISHED_TELNYX_KEYS.has(key)) {
    console.error("TELNYX_PUBLIC_KEY is a test key whose private half is published in this repository; every Telnyx request is refused in production until it is replaced");
    return { kind: "refused" };
  }
  return { kind: "set", key };
}
