/**
 * SCANNER_CLIENTS: `<secret>@<origin>` entries, separated by commas or spaces (plan deviation 4).
 * Each caller (Production, Preview, the e2e stack) has its own secret, and a request signed with it
 * may only fetch from that caller's own storage origin. Errors never echo a secret.
 */
export function parseClients(raw) {
  const entries = String(raw ?? "").split(/[\s,]+/).filter(Boolean);
  if (entries.length === 0) throw new Error("SCANNER_CLIENTS is empty: refusing to start");
  return entries.map((entry) => {
    const at = entry.indexOf("@");
    if (at < 16) throw new Error("SCANNER_CLIENTS: each entry is <secret of 16 or more characters>@<origin>");
    const originText = entry.slice(at + 1).replace(/\/$/, "");
    let origin;
    try { origin = new URL(originText).origin; } catch { throw new Error("SCANNER_CLIENTS: an origin is not a URL"); }
    if (origin !== originText) throw new Error("SCANNER_CLIENTS: an origin is scheme://host[:port] only");
    return { secret: entry.slice(0, at), origin };
  });
}
