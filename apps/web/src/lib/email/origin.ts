/**
 * The absolute origin a link inside an email (or a dashboard link inside an
 * alert) must carry.
 *
 * ORIGINAL DESIGN (superseded, kept here so the reversal is legible): there
 * was deliberately no env var for this. A value someone has to remember to
 * set is a value that will be wrong on the first custom domain; the Host
 * header is whatever the visitor actually reached, so it is correct by
 * construction — including for a domain that does not exist yet. True for
 * every request a *browser* sends.
 *
 * REVERSED 2026-08-27, after the deliverability investigation closed: the
 * Host header is only trustworthy when a browser is the one setting it.
 * The cron reminder route and the voice incoming webhook aren't browser
 * requests — they build their link origin from `req.url`, which for a
 * server-to-server invocation is the deployment's own `vercel.app` URL, not
 * whatever domain a human associates with the business. That mismatch
 * between the link's domain and the sender's domain is exactly what Gmail
 * was silently discarding platform mail over, until the fix (routing both
 * link generation and sending through the custom domain app.bis-rgv.com)
 * closed the saga. APP_ORIGIN exists so cron/webhook call sites can pin the
 * same custom-domain origin a real visitor's Host header already carries,
 * instead of leaking the deployment URL. It is checked FIRST, ahead of the
 * Host header, everywhere origin is derived — including here — so a browser
 * request on the custom domain and a cron tick with no browser behind it
 * produce the identical link.
 *
 * Returns null when there is no host to build on and APP_ORIGIN is unset.
 * The caller must then omit the link entirely rather than fall back to a
 * relative path: a bare `/dashboard/...` in an email is not a link in any
 * client, and removing that is the point of this work.
 */
export function originFrom(h: Headers): string | null {
  const configured = configuredOrigin();
  if (configured) return configured;
  const host = h.get("host");
  if (!host) return null;
  // Comma-separated through a proxy chain; the first value is the scheme the
  // client actually used.
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

/**
 * `APP_ORIGIN`, trimmed and stripped of any trailing slash(es) — or null
 * when unset/blank. `env` defaults to `process.env`; a test passes a literal
 * object rather than mutating global env.
 */
export function configuredOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_ORIGIN?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}
