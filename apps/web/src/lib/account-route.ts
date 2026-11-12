// apps/web/src/lib/account-route.ts
/**
 * The in-account route shape; capture group 1 is the accountId segment.
 * Originally lifted out of app-sidebar.tsx (whose own copy predated this
 * module and stayed module-private there) for topbar-presence.tsx, the
 * second pathname-keyed client component that needed the exact same
 * `/dashboard/accounts/<id>/...` match. app-sidebar.tsx now imports this
 * same export too (its private copy retargeted here as part of the P3 shell
 * dedup) — every pathname-keyed client component in this tree, including
 * shell-data.tsx's own effect, shares this one regex.
 */
export const ACCOUNT_ROUTE_RE = /^\/dashboard\/accounts\/([^/]+)/;

/**
 * Which account the sidebar's menu points at. The account in the URL wins.
 * Off an account's routes (the person's own Preferences, say), a client
 * still belongs to exactly one business, so the menu keeps pointing there
 * instead of falling to the agency's top-level scope, which a client has
 * no items in (owner report, 2026-11-12: Preferences left a client with
 * an empty sidebar and no way back). The agency has no home account: off
 * an account it gets its own top-level menu, as before.
 */
export function sidebarAccountBase(
  pathname: string,
  isAgency: boolean,
  clientAccountId: string | undefined,
): string | null {
  const fromUrl = pathname.match(ACCOUNT_ROUTE_RE)?.[1];
  const id = fromUrl ?? (isAgency ? undefined : clientAccountId);
  return id ? `/dashboard/accounts/${id}` : null;
}
