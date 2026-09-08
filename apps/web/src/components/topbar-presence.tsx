"use client";

import { m } from "@/lib/messages";
// Presence reads from the one shared shell fetch (shell-data.tsx) — see its
// own doc comment for why the read lives in the [accountId] segment (via
// shell-actions.ts) rather than dashboard/layout.tsx, which is where Topbar
// (this component's parent) actually renders, and for the
// paired-state/derive-by-account-match shape that used to live here as its
// own effect before this task coalesced it with the sidebar's two.
import { useShellData } from "@/components/shell-data";

/**
 * DESIGN.md's "AI presence" key pattern: "● Sofía · on a call" (pulse) /
 * "✓ N calls handled this week" (idle) — rendered inside Topbar (still a
 * server component; this is the small "use client" child it mounts, per
 * Task 5's CORRECTED brief). In-account only and both-audience: it renders
 * nothing at all outside an account, and nothing when the account has no
 * ENABLED voice profile (not the idle state — that distinction is drawn
 * server-side, in shell-actions.ts, not here).
 */
export function TopbarPresence() {
  const presence = useShellData()?.presence ?? null;

  // Covers three cases at once, all "render nothing": off-account, no
  // enabled voice profile (shell-actions.ts's own null), and any guard or
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
            needing a `motion-reduce:` override here). bg-primary is the
            BRAND accent, so on a themed account the dot wears the tenant's
            color, not BIS violet — deliberate (final review recorded it):
            the whole shell re-tints for themed clients and a hardcoded
            violet dot would be the one off-brand element. */}
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary animate-pulse shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_22%,transparent)]" />
        {m["shell.presence.onCall"]}
      </span>
    );
  }

  return (
    <span className="text-sm text-muted-foreground">
      {presence.weekCount === 1
        ? m["shell.presence.idleOne"]
        : m["shell.presence.idle"].replace("{count}", String(presence.weekCount))}
    </span>
  );
}
