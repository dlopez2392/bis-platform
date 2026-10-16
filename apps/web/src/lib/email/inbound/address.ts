/** S-06 part 1: the r-<token>@<reply domain> address (spec decision 5). Pure. */
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";
export type ReplyAddress = { token: string; domain: string };

const ANGLE = /<([^<>\s]+@[^<>\s]+)>/;
const BARE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function bareAddress(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const inner = ANGLE.exec(v)?.[1] ?? v;
  const a = inner.trim().toLowerCase();
  return BARE.test(a) ? a : null;
}

export function displayName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const i = v.indexOf("<");
  if (i <= 0) return null;
  const name = v.slice(0, i).trim().replace(/^"(.*)"$/, "$1").trim();
  return name || null;
}

export function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  const d = at > 0 ? address.slice(at + 1).trim().toLowerCase() : "";
  return d || null;
}

const LOCAL = /^r-([0-9a-f]{24})$/;

export function parseReplyAddress(raw: string): ReplyAddress | null {
  const a = bareAddress(raw);
  if (!a) return null;
  const at = a.lastIndexOf("@");
  const m = LOCAL.exec(a.slice(0, at));
  const domain = a.slice(at + 1);
  return m && domain ? { token: m[1]!, domain } : null;
}

export function replyAddressFor(token: string, s: { mode: "off" | "bis" | "own_domain"; domain: string | null }): string | null {
  if (s.mode === "bis") return `r-${token}@${BIS_REPLY_DOMAIN}`;
  if (s.mode === "own_domain" && s.domain) return `r-${token}@${s.domain}`;
  return null;
}
