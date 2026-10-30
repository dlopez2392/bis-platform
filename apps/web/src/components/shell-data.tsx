"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ACCOUNT_ROUTE_RE } from "@/lib/account-route";
import type { ShellBusinessStatus, ShellSnapshot } from "@/lib/shell/snapshot";

/**
 * The shell's one read, a plain GET of `api/accounts/[accountId]/shell` — never a server action. Next posts
 * a server action to the router's CURRENT url, and its redirect or a cookie-modifying response navigates
 * or refreshes the whole page: the agency refresh loop after the reason chooser (production, 2026-10-30).
 * A fetch cannot move the page, and `redirect: "error"` refuses to follow one into some other page's HTML.
 * A 204 (refused, or the agency with no live visit) is `null`; anything else not ok rejects, for the
 * provider to swallow.
 */
export async function fetchShellSnapshot(
  accountId: string, fetchImpl: typeof fetch = fetch,
): Promise<ShellSnapshot | null> {
  const res = await fetchImpl(`/api/accounts/${accountId}/shell`, { cache: "no-store", redirect: "error" });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`shell read failed: ${res.status}`);
  return (await res.json()) as ShellSnapshot;
}

type ShellDataState = { accountId: string; snapshot: ShellSnapshot } | null;

type ShellDataContextValue = {
  state: ShellDataState;
  // S-47d Task 11: the switch's own menu applies a change locally, at once — the dashboard card and
  // the topbar must agree the instant it does, without waiting for a background re-fetch. Lives beside
  // `state`, not folded into it: the override outlives whichever snapshot was on screen when it was
  // set, and is cleared the moment a FRESH snapshot for the active account lands (never a timer, never
  // polling — DESIGN.md: "the shell is never polled").
  override: ShellBusinessStatus | null;
  setBusinessStatus: (s: ShellBusinessStatus) => void;
};

const ShellDataContext = createContext<ShellDataContextValue>({
  state: null, override: null, setBusinessStatus: () => {},
});

/**
 * The shell's one background fetch per in-account navigation — replaces the
 * three separate pathname-keyed effects app-sidebar.tsx and
 * topbar-presence.tsx used to each own (getUnreadTotal, getSetupProgress,
 * getVoicePresenceSnapshot). One effect, one GET (fetchShellSnapshot above).
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
  const [override, setOverride] = useState<ShellBusinessStatus | null>(null);

  useEffect(() => {
    const accountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1];
    if (!accountId) return;
    let cancelled = false;
    fetchShellSnapshot(accountId)
      .then((snapshot) => {
        // null: nothing to show (refused, or no live visit yet). Keep whatever is on screen.
        if (snapshot && !cancelled) {
          setState({ accountId, snapshot });
          // The fresh read REPLACES the local override outright, same navigation that fetched it —
          // never reconciled against it, never kept around once a real snapshot answers again.
          setOverride(null);
        }
      })
      .catch(() => {
        // Client-leg failure (offline, the route itself erroring)
        // keeps the last known snapshot — the shell must never take itself
        // down or surface an error of its own over a background read.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const value: ShellDataContextValue = { state, override, setBusinessStatus: setOverride };
  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
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
 *
 * `businessStatus` on the returned object is the local override when one is
 * set, else the snapshot's own — the one field a caller never reads straight
 * off `state.snapshot`. `setBusinessStatus` (S-47d Task 11) is the switch's
 * own menu's write: it is ALWAYS the stable `setOverride` function, even
 * before the first fetch resolves, so a menu mounted the instant the shell
 * loads never calls `undefined`. `accountId` (S-47d Task 11) is this same
 * already-matched id — the switch's menu needs it (every action it calls is
 * scoped to an account), and it would otherwise have to re-derive it from
 * `usePathname()` with its own copy of `ACCOUNT_ROUTE_RE`.
 */
export function useShellData():
  (ShellSnapshot & { accountId: string; setBusinessStatus: (s: ShellBusinessStatus) => void }) | null {
  const pathname = usePathname();
  const { state, override, setBusinessStatus } = useContext(ShellDataContext);
  const activeAccountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1];
  if (!state || state.accountId !== activeAccountId) return null;
  return {
    ...state.snapshot, accountId: state.accountId,
    businessStatus: override ?? state.snapshot.businessStatus, setBusinessStatus,
  };
}
