/**
 * F-118 part 1 (spec 3.2): pure path helpers for the reason gate. Imported by proxy.ts, so nothing
 * server-only here.
 */
export const BIS_PATH_HEADER = "x-bis-path";

const ACCOUNT_PATH = /^\/dashboard\/accounts\/[^/?#]+(?:\/|$)/;
const MAX_PATH = 2048;

/** The in-account path a request asked for (pathname + search, without Next's internal `_rsc`), or null. */
export function accountPathOf(url: { pathname: string; search: string }): string | null {
  if (!ACCOUNT_PATH.test(url.pathname)) return null;
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const qs = params.toString();
  return url.pathname + (qs ? `?${qs}` : "");
}

/** A C0 control character or DEL anywhere in the string. */
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/**
 * `raw` when it is a path inside THIS account and nothing else; null otherwise. The id is compared without
 * case (a UUID may arrive in either), and it must end at a segment boundary, so account `A` never admits
 * `/dashboard/accounts/AB`. No `//` and no `\` anywhere: either could turn a path into another origin.
 */
export function safeReturnPath(raw: unknown, accountId: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PATH) return null;
  if (raw.includes("//") || raw.includes("\\") || hasControl(raw)) return null;
  const prefix = `/dashboard/accounts/${accountId}`.toLowerCase();
  const lower = raw.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const rest = lower.slice(prefix.length);
  return rest === "" || rest.startsWith("/") || rest.startsWith("?") ? raw : null;
}

/** The chooser for this account, carrying the in-account path to return to when there is one. */
export function enterHref(accountId: string, to: string | null): string {
  return `/dashboard/enter/${accountId}${to ? `?to=${encodeURIComponent(to)}` : ""}`;
}
