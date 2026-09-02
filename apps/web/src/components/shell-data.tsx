"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ACCOUNT_ROUTE_RE } from "@/lib/account-route";
// A direct import of a "use server" export into this client component —
// Next.js compiles it to a callable stub, no <form action> needed. See
// shell-actions.ts's own doc comment for why this one read has to live in
// the [accountId] segment rather than dashboard/layout.tsx, which is where
// this provider itself mounts.
import { getShellSnapshot, type ShellSnapshot } from "@/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions";

type ShellDataState = { accountId: string; snapshot: ShellSnapshot } | null;

const ShellDataContext = createContext<ShellDataState>(null);

/**
 * The shell's one background fetch per in-account navigation — replaces the
 * three separate pathname-keyed effects app-sidebar.tsx and
 * topbar-presence.tsx used to each own (getUnreadTotal, getSetupProgress,
 * getVoicePresenceSnapshot), which fired as three separate `"use server"`
 * POSTs Next.js then ran SERIALLY, queuing behind any user mutation on the
 * same navigation. One effect, one call, one queue slot.
 *
 * Mounted in dashboard/layout.tsx wrapping AppSidebar + Topbar + `<main>` —
 * both consumers of `useShellData()` below sit inside it.
 *
 * Re-read on every route change (soft navigations included, hence keying on
 * `pathname` and re-deriving the account id inside), so leaving an account
 * — or reading your conversations, on the very next navigation — refreshes
 * the shell, but nothing is ever polled: an idle tab costs nothing, and the
 * data only goes stale while the user sits still on one route. Off-account
 * routes (`accountId` undefined) skip the fetch entirely — there is nothing
 * to show at the agency top level.
 *
 * State is paired with the account id it was fetched for, `{ accountId,
 * snapshot }`, rather than a bare snapshot reset via its own setState call:
 * react-hooks' set-state-in-effect rule flags a synchronous setState in an
 * effect body (only the fetch's own `.then()` callback below is exempt, as
 * an update from an external system). Pairing lets "clear the shell when
 * leaving an account" fall out of `useShellData`'s own derived-mismatch
 * check below instead of a second state write — the exact shape
 * app-sidebar.tsx's own unread/setup effects used before this task, and
 * topbar-presence.tsx's presence effect used independently for the same
 * reason.
 */
export function ShellDataProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<ShellDataState>(null);

  useEffect(() => {
    const accountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1];
    if (!accountId) return;
    let cancelled = false;
    getShellSnapshot(accountId)
      .then((snapshot) => {
        if (!cancelled) setState({ accountId, snapshot });
      })
      .catch(() => {
        // Client-leg failure (offline, the action route itself erroring)
        // keeps the last known snapshot — the shell must never take itself
        // down or surface an error of its own over a background read.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return <ShellDataContext.Provider value={state}>{children}</ShellDataContext.Provider>;
}

/**
 * `null` outside an account, before the first fetch resolves, or once the
 * user has navigated to a different account than the in-flight/last-fetched
 * one (the accountId-paired mismatch check below) — every consumer has
 * exactly one "nothing yet" case to handle, matching the single `if
 * (!presence) return null;` shape topbar-presence.tsx already used.
 * Consumers destructure the field(s) they need and fall back to their own
 * hidden value (`unreadTotal ?? 0`, `setup ?? { done: 0, total: 0 }`) — this
 * hook only ever answers "is there a snapshot for the account on screen
 * right now", never a partial one.
 */
export function useShellData(): ShellSnapshot | null {
  const pathname = usePathname();
  const state = useContext(ShellDataContext);
  const activeAccountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1];
  return state && state.accountId === activeAccountId ? state.snapshot : null;
}
