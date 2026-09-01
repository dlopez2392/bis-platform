"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { m } from "@/lib/messages";
import { ACCOUNT_ROUTE_RE } from "@/lib/account-route";
// A direct import of a "use server" export into this client component —
// Next.js compiles it to a callable stub, no <form action> needed. Same
// shape app-sidebar.tsx uses for getUnreadTotal/getSetupProgress; see
// presence-actions.ts's own doc comment for why the read has to live in the
// [accountId] segment rather than dashboard/layout.tsx, which is where
// Topbar (this component's parent) actually renders.
import { getVoicePresenceSnapshot } from "@/app/(dashboard)/dashboard/accounts/[accountId]/presence-actions";
import type { VoicePresence } from "@/lib/voice/presence";

/**
 * DESIGN.md's "AI presence" key pattern: "● Sofía · on a call" (pulse) /
 * "✓ N calls handled this week" (idle) — rendered inside Topbar (still a
 * server component; this is the small "use client" child it mounts, per
 * Task 5's CORRECTED brief). In-account only and both-audience: it renders
 * nothing at all outside an account, and nothing when the account has no
 * ENABLED voice profile (not the idle state — that distinction is drawn
 * server-side, in presence-actions.ts, not here).
 *
 * Deliberately request-time → PER-NAVIGATION, not live-polled (the brief's
 * own recorded deviation): a pathname-keyed effect that re-derives the
 * account id inside itself, `cancelled` cleanup, and a `.catch(() => {})` on
 * the client leg — the exact shape app-sidebar.tsx's unread/setup effects
 * already use, chosen again here for the same two reasons: it satisfies
 * react-hooks' set-state-in-effect rule (only the fetch's own `.then()`
 * callback sets state, never the effect body synchronously), and pairing the
 * fetched snapshot with the accountId it was fetched for means "clear the
 * indicator when you leave the account" falls out of a derived mismatch on
 * render instead of a second state write. No polling means an idle tab
 * costs nothing; presence only goes stale while the user sits still on one
 * route (revisit later, per the brief).
 */
export function TopbarPresence() {
  const pathname = usePathname();
  const [state, setState] = useState<{ accountId: string; presence: VoicePresence | null } | null>(null);

  useEffect(() => {
    const accountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1];
    if (!accountId) return;
    let cancelled = false;
    getVoicePresenceSnapshot(accountId)
      .then((presence) => {
        if (!cancelled) setState({ accountId, presence });
      })
      .catch(() => {
        // Client-leg failure (offline, the action route itself erroring) —
        // presence must never take the topbar down or surface an error of
        // its own. Falling out of this effect with `state` unchanged means
        // the indicator either keeps showing its last known snapshot or,
        // pre-first-fetch, keeps rendering nothing — both acceptable, same
        // reasoning as the sidebar badges' own catch.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Stale account's snapshot never leaks under a different account while its
  // own fetch is still in flight — and there is nothing to show off-account
  // (activeAccountId undefined) — both without a second, effect-synchronous
  // setState call. Same derivation shape as app-sidebar.tsx's unreadTotal.
  const activeAccountId = pathname.match(ACCOUNT_ROUTE_RE)?.[1];
  const presence = state && state.accountId === activeAccountId ? state.presence : null;

  // Covers three cases at once, all "render nothing": off-account, no
  // enabled voice profile (presence-actions.ts's own null), and any guard or
  // query failure (also folded to null there) — the component has exactly
  // one nothing-to-show branch, not three.
  if (!presence) return null;

  if (presence.onCall) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-foreground">
        {/* Decorative only — "Sofía · on a call" below already carries the
            meaning on its own, per DESIGN.md's status rule (never color
            alone: dot + word). animate-pulse is killed by the global
            `prefers-reduced-motion` rule in globals.css (a `*` selector with
            `!important`, so it beats this utility's own animation without
            needing a `motion-reduce:` override here). */}
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary animate-pulse" />
        {m["shell.presence.onCall"]}
      </span>
    );
  }

  return (
    <span className="text-sm text-muted-foreground">
      {m["shell.presence.idle"].replace("{count}", String(presence.weekCount))}
    </span>
  );
}
