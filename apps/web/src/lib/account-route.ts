// apps/web/src/lib/account-route.ts
/**
 * The in-account route shape; capture group 1 is the accountId segment.
 * Lifted out of app-sidebar.tsx (whose own copy predates this module and
 * stays module-private there — not retargeted here, to avoid touching a
 * working file for this task) for topbar-presence.tsx, the second
 * pathname-keyed client component that needs the exact same
 * `/dashboard/accounts/<id>/...` match: both derive the active account id
 * from the current pathname inside a `usePathname()`-driven effect, the
 * shape app-sidebar.tsx's own unread/setup effects established.
 */
export const ACCOUNT_ROUTE_RE = /^\/dashboard\/accounts\/([^/]+)/;
