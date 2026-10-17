import { emailKey } from "./contacts";

/**
 * S-06 part 2 (0083): the Never record list's two pure rules. Imported by the web from the SUBPATH
 * `@bis/db/never-log-rules`, so a test that mocks `@bis/db` still runs the real matcher.
 * SQL twin of parseNeverLogPattern: 0083's inbound_never_log_pattern_check.
 */
export { emailKey };
export type NeverLogKind = "address" | "domain";
export type NeverLogPattern = { pattern: string; kind: NeverLogKind };
/** Spec: at most 200 entries per account (enforced by addNeverLog; plan G11). */
export const NEVER_LOG_MAX = 200;

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// RFC 5322 atext, lowercase, without "+": an address entry is stored as its email key, which has no +tag.
const LOCAL = /^[a-z0-9.!#$%&'*/=?^_`{|}~-]+$/;

export function parseNeverLogPattern(input: string): NeverLogPattern | null {
  const v = input.trim().toLowerCase();
  if (!v || v.length > 254 || /\s/.test(v)) return null;
  const at = v.indexOf("@");
  if (at === -1) return DOMAIN.test(v) ? { pattern: v, kind: "domain" } : null;
  if (at === 0 || at !== v.lastIndexOf("@")) return null;
  const key = emailKey(v);
  const k = key.indexOf("@");
  const local = key.slice(0, k);
  const domain = key.slice(k + 1);
  if (!local || !LOCAL.test(local) || !DOMAIN.test(domain) || key.length > 254) return null;
  return { pattern: key, kind: "address" };
}

/** The sender is on the list: an address entry equals its email key; a domain entry is its domain or a parent of it. */
export function neverLogMatches(entries: readonly NeverLogPattern[], fromAddress: string | null): boolean {
  if (!fromAddress) return false;
  const key = emailKey(fromAddress);
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return false;
  const domain = key.slice(at + 1);
  return entries.some((e) => (e.kind === "address" ? e.pattern === key : domain === e.pattern || domain.endsWith(`.${e.pattern}`)));
}
