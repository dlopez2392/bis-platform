/** S-06 part 1: the r-<token>@<reply domain> address (spec decision 5). Pure. */
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";
export type ReplyAddress = { token: string; domain: string };

const HAS_LETTER = /\p{L}/u;

/**
 * CRITICAL (review round 2): a strict, fail-closed grammar replaces the
 * round-1 case-by-case patches (which still let a trailing comment, trailing
 * junk after an angle-addr, or a backslash-escape trick inside a quoted
 * display slip through). A held/rejected message is never lost — it is
 * merely held for staff — so strictness here is cheap and a forged sender is
 * not. The WHOLE trimmed value must be exactly one of:
 *   (a) a bare addr-spec: local@domain
 *   (b) an optional display name, then exactly one angle-addr that ENDS the
 *       value: `<display> <local@domain>`
 * <display> is either a quoted-string containing none of " \ < > ( ) inside
 * the quotes, or an unquoted run containing none of " \ < > ( ) @ , ; :.
 * The addr-spec itself: local part of RFC 5322's unquoted atext set, domain
 * of dot-joined `[A-Za-z0-9-]+` labels (at least one dot) — no whitespace,
 * no `( ) " < > \ ,` anywhere in either shape.
 */
const ADDR_SPEC = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const BARE_RE = new RegExp(`^${ADDR_SPEC.source}$`);
const ANGLE_RE = new RegExp(`^(?:"([^"\\\\<>()]*)"|([^"\\\\<>()@,;:]+))?\\s*<(${ADDR_SPEC.source})>$`);

export function bareAddress(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  // Review round 3: this early return is now REDUNDANT with the grammar —
  // every character class in both BARE_RE and ANGLE_RE already excludes
  // "(" (and so does the quoted/unquoted display grammar inside ANGLE_RE),
  // so no string containing "(" can match either regex regardless of this
  // line. Kept anyway as a deliberate belt-and-braces guard: a parenthetical
  // (comment) is refused before the regexes are even asked, so a future
  // change to either pattern that accidentally widened a character class
  // still has this line as a second, independent backstop against the
  // `attacker@customer.com (<ana@customer.com>)` forgery. No test can
  // distinguish this line's presence from its absence — that redundancy is
  // the point, and it is deliberate, not a vacuous test (see address.test.ts).
  if (v.includes("(")) return null;
  if (BARE_RE.test(v)) return v.toLowerCase();
  const m = ANGLE_RE.exec(v);
  return m ? m[3]!.toLowerCase() : null;
}

export function displayName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  // Same belt-and-braces guard as bareAddress — see its comment.
  if (v.includes("(")) return null;
  const m = ANGLE_RE.exec(v);
  if (!m) return null;
  const name = (m[1] ?? m[2] ?? "").trim();
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
