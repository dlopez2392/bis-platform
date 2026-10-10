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
 * "{name} · on a call" with THIS account's own configured persona
 * (voice_profiles.persona_name), never a hard-coded "Sofía" — some clients
 * rename theirs (D-063 follow-up). Pulled out of the component as a pure
 * function so it has a unit-test seam that doesn't need a render harness —
 * the repo has no .tsx test convention today (stat-tile.tsx's own
 * `hasStatContext` carries the identical note). A function replacer, not a
 * plain string, for the same reason dashboard/page.tsx's own {name}
 * substitutions use one: a persona containing "$&" must not be
 * re-interpreted as a replacement pattern.
 */
export function onCallText(personaName: string | null | undefined): string {
  return m["shell.presence.onCall"].replace("{name}", () => personaName?.trim() || "Sofía");
}

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

  // F-107 r4 review (item 1): below `sm` the full phrase does not fit next
  // to the icon-only search trigger, ThemeToggle, OrganizationSwitcher and
  // UserButton — two renders per state (one `sm:hidden`, one `hidden
  // sm:flex`), the same "both variants always in the DOM, CSS picks"
  // pattern this rider uses throughout, rather than a JS viewport check
  // that would risk a hydration flash.
  if (presence.onCall) {
    const dot = (
      // Decorative only — the word beside it already carries the meaning
      // on its own, per DESIGN.md's status rule (never color alone: dot +
      // word). animate-pulse is killed by the global
      // `prefers-reduced-motion` rule in globals.css (a `*` selector with
      // `!important`, so it beats this utility's own animation without
      // needing a `motion-reduce:` override here). bg-primary is the
      // BRAND accent, so on a themed account the dot wears the tenant's
      // color, not BIS violet — deliberate (final review recorded it):
      // the whole shell re-tints for themed clients and a hardcoded
      // violet dot would be the one off-brand element.
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary animate-pulse shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_22%,transparent)]" />
    );
    return (
      // `data-testid` on the OUTER wrapper, not the Fragment it replaces
      // (F-107 r4 review, item 2 follow-on): the e2e sweep's own wait
      // needs ONE unambiguous target — `getByText(/this week/)` matched
      // BOTH the `sm:hidden` and the `hidden sm:block` span (both contain
      // matching text) and `.first()` did not reliably resolve to the one
      // actually visible at phone width, so `waitFor({state:"visible"})`
      // sometimes waited on the WRONG span forever. A single wrapper is
      // "visible" as soon as whichever CHILD the viewport shows has
      // rendered, regardless of which that is.
      <span data-testid="topbar-presence">
        <span className="flex items-center gap-1.5 text-sm text-foreground sm:hidden">
          {dot}
          {m["shell.presence.onCallShort.en"]}
        </span>
        <span className="hidden items-center gap-1.5 text-sm text-foreground sm:flex">
          {dot}
          {onCallText(presence.personaName)}
        </span>
      </span>
    );
  }

  return (
    <span data-testid="topbar-presence">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:hidden">
        {/* A static (non-pulsing) dot — rule 3's "dot + word" applies to
            idle the same as on-call; the full phrase's own leading "✓"
            stays a plain-text glyph (unchanged below, at sm+) rather than
            a second dot convention. */}
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--good)]" />
        {presence.weekCount === 1
          ? m["shell.presence.idleShortOne.en"]
          : m["shell.presence.idleShort.en"].replace("{count}", String(presence.weekCount))}
      </span>
      <span className="hidden text-sm text-muted-foreground sm:block">
        {presence.weekCount === 1
          ? m["shell.presence.idleOne"]
          : m["shell.presence.idle"].replace("{count}", String(presence.weekCount))}
      </span>
    </span>
  );
}
