/**
 * The absolute origin a link inside an email must carry, taken from the
 * request that triggered the send.
 *
 * There is deliberately no env var for this. A value someone has to remember
 * to set is a value that will be wrong on the first custom domain; the Host
 * header is whatever the visitor actually reached, so it is correct by
 * construction — including for a domain that does not exist yet.
 *
 * Returns null when there is no host to build on. The caller must then omit
 * the link entirely rather than fall back to a relative path: a bare
 * `/dashboard/...` in an email is not a link in any client, and removing that
 * is the point of this work.
 */
export function originFrom(h: Headers): string | null {
  const host = h.get("host");
  if (!host) return null;
  // Comma-separated through a proxy chain; the first value is the scheme the
  // client actually used.
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  return `${proto}://${host}`;
}
