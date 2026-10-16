/** S-06 part 1: the r-<token>@<reply domain> address (spec decision 5). Pure. */
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";
export type ReplyAddress = { token: string; domain: string };

const ANGLE_G = /<([^<>\s]+@[^<>\s]+)>/g;
const BARE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HAS_LETTER = /\p{L}/u;

/** The index ranges, [start, end), of every "..."-quoted span in `v` (naive: no escaped-quote handling, which this header shape never needs). */
function quotedRanges(v: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let i = 0;
  while (i < v.length) {
    if (v[i] === '"') {
      const end = v.indexOf('"', i + 1);
      if (end === -1) break;
      ranges.push({ start: i, end: end + 1 });
      i = end + 1;
    } else {
      i++;
    }
  }
  return ranges;
}

const insideAQuote = (pos: number, ranges: { start: number; end: number }[]) =>
  ranges.some((r) => pos > r.start && pos < r.end);

/**
 * CRITICAL (review round 1): a quoted display name can itself carry a fake
 * `<a@b>`-shaped token, and an unquoted From can carry two real-looking
 * angle-addrs. Either way there is more than one address-shaped token in the
 * value, and picking "the first one" is exactly the swap a forged From
 * exploits. So: more than one angle-addr anywhere (quoted or not) fails
 * closed to null, and so does exactly one angle-addr that sits INSIDE a
 * quoted string (there is then no legitimate address outside the quotes).
 */
export function bareAddress(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const ranges = quotedRanges(v);
  const matches: { index: number; addr: string }[] = [];
  for (const m of v.matchAll(ANGLE_G)) matches.push({ index: m.index, addr: m[1]! });
  if (matches.length > 1) return null;
  if (matches.length === 1) {
    const only = matches[0]!;
    if (insideAQuote(only.index, ranges)) return null;
    const a = only.addr.trim().toLowerCase();
    return BARE.test(a) ? a : null;
  }
  const a = v.toLowerCase();
  return BARE.test(a) ? a : null;
}

export function displayName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const i = v.indexOf("<");
  if (i <= 0) return null;
  const name = v.slice(0, i).trim().replace(/^"(.*)"$/, "$1").trim();
  // M4: a forged quoted fake address can collapse `name` to a lone quote
  // character or other punctuation with no letter in it — never a real name.
  return name && HAS_LETTER.test(name) ? name : null;
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
