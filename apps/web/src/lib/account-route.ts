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
