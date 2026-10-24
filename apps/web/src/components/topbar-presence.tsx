"use client";

import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";
// Presence reads from the one shared shell fetch (shell-data.tsx) — see its
// own doc comment for why the read lives in the [accountId] segment (via
// shell-actions.ts) rather than dashboard/layout.tsx, which is where Topbar
// (this component's parent) actually renders, and for the
// paired-state/derive-by-account-match shape that used to live here as its
// own effect before this task coalesced it with the sidebar's two.
import { useShellData } from "@/components/shell-data";
import type { ShellPresence } from "@/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions";
// S-47d Task 11 (spec §5.6.1, S15): the one switch's own words, and its menu
// when the viewer may change it.
import { BusinessStatusMenu } from "@/components/business-status-menu";
import { fromWire } from "@/lib/business-status/status";
import { topbarLabels } from "@/lib/business-status/labels";

/**
 * "{name} · on a call" with THIS account's own configured persona
 * (voice_profiles.persona_name), never a hard-coded "Sofía" — some clients
 * rename theirs (D-063 follow-up). Pulled out of the component as a pure
 * function so it has a unit-test seam that doesn't need a render harness —
 * the repo has no .tsx test convention today (stat-tile.tsx's own
 * `hasStatContext` carries the identical note). A function replacer, not a
 * plain string, for the same reason dashboard/page.tsx's own {name}
 * substitutions use one: a persona containing "$&" must not be
 * re-interpreted as a replacement pattern — t()'s own generic interpolate()
 * uses a STRING replaceAll, which re-honors "$&" in the REPLACEMENT value
 * same as String.prototype.replace does, so the name is substituted by hand
 * here (via `t()` with no params, which returns the raw per-locale template
 * untouched) rather than passed through t()'s params. `locale` defaults to
 * "en" so every call site that predates Task 6 (the five tests below)
 * keeps resolving exactly as before.
 */
export function onCallText(personaName: string | null | undefined, locale: Locale = "en"): string {
  return t(m, "shell.presence.onCall", locale).replace("{name}", () => personaName?.trim() || "Sofía");
}

/** A static dot in `color` — rule 3's dot+word, decorative only (the word beside it already carries
 *  the meaning), so every call site shares one element shape. */
function StatusDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={pulse ? "size-2 shrink-0 rounded-full bg-primary animate-pulse shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_22%,transparent)]" : "size-2 shrink-0 rounded-full"}
      style={pulse ? undefined : { backgroundColor: color }}
    />
  );
}

/**
 * The idle count's OWN markup (F-085 part 1, spec §7.2), unchanged since before this task — a static,
 * non-pulsing dot and the leading "✓" baked into the catalogue's full-width phrase, never a SECOND
 * dot convention. Pulled into its own function (parameter `presence`, properly non-null, shadowing
 * the outer one) purely so `topbar-presence.test.ts`'s own pre-existing source-text pins — which check
 * `presence.weekCount` literally, not a renamed variable or a `presence!` assertion — still match
 * byte-for-byte once this slot has to share its wrapper with two more states (below).
 */
function idleWords(presence: ShellPresence & { showCount: true }, locale: Locale) {
  return (
    <>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:hidden">
        {/* A static (non-pulsing) dot — rule 3's "dot + word" applies to
            idle the same as on-call; the full phrase's own leading "✓"
            stays a plain-text glyph (unchanged below, at sm+) rather than
            a second dot convention. */}
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--good)]" />
        {presence.weekCount === 1
          ? t(m, "shell.presence.idleShortOne", locale)
          : t(m, "shell.presence.idleShort", locale, { count: presence.weekCount })}
      </span>
      <span className="hidden text-sm text-muted-foreground sm:block">
        {presence.weekCount === 1
          ? t(m, "shell.presence.idleOne", locale)
          : t(m, "shell.presence.idle", locale, { count: presence.weekCount })}
      </span>
    </>
  );
}

/** The "not open" / "● Open" shape (spec §5.6.1) — a real dot at BOTH widths (rule 3), unlike idle's
 *  own shape above. */
function closedWords(dotClass: string, short: string, full: string) {
  return (
    <>
      <span className="flex items-center gap-1.5 text-sm text-foreground sm:hidden">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotClass}`} />
        {short}
      </span>
      <span className="hidden items-center gap-1.5 text-sm text-foreground sm:flex">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotClass}`} />
        {full}
      </span>
    </>
  );
}

/**
 * DESIGN.md's "AI presence" key pattern: "● Sofía · on a call" (pulse) /
 * "✓ N calls handled this week" (idle) — rendered inside Topbar (still a
 * server component; this is the small "use client" child it mounts, per
 * Task 5's CORRECTED brief). In-account only: it renders nothing at all
 * outside an account.
 *
 * S-47d Task 11 (spec §5.6.1, S15): not open, the switch's own words
 * replace the idle count FOR EVERYONE (Technicians included — spec: "the
 * same words, no button"), because the business being closed is a fact
 * about the business, not about who is asking. Open with no enabled voice
 * profile shows nothing UNLESS the viewer has `canChange`, in which case
 * "● Open" becomes the menu's own trigger — the one case `presence` being
 * null does NOT mean "render nothing" any more.
 */
export function TopbarPresence() {
  const shell = useShellData();
  const presence = shell?.presence ?? null;
  const businessStatus = shell?.businessStatus ?? null;
  const locale = useLocale();

  const effective = businessStatus ? fromWire(businessStatus.effective) : null;
  // null for Open (topbarLabels' own contract) or when the leg itself could not be read.
  const labels = effective ? topbarLabels(effective, businessStatus!.timezone, new Date(businessStatus!.now), locale) : null;

  // F-107 r4 review (item 1): below `sm` the full phrase does not fit next
  // to the icon-only search trigger, ThemeToggle, OrganizationSwitcher and
  // UserButton — two renders per state (one `sm:hidden`, one `hidden
  // sm:flex`), the same "both variants always in the DOM, CSS picks"
  // pattern this rider uses throughout, rather than a JS viewport check
  // that would risk a hydration flash.
  if (presence?.onCall) {
    const dot = <StatusDot color="var(--good)" pulse />;
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
      <span data-testid="topbar-presence" lang={locale}>
        <span className="flex items-center gap-1.5 text-sm text-foreground sm:hidden">
          {dot}
          {t(m, "shell.presence.onCallShort", locale)}
        </span>
        <span className="hidden items-center gap-1.5 text-sm text-foreground sm:flex">
          {dot}
          {onCallText(presence.personaName, locale)}
          {/* Spec §5.6.1: "the on-call pulse stays and the status follows it at sm and up" —
              never below sm, where there is no room for a second phrase. */}
          {labels ? ` · ${labels.full}` : null}
        </span>
      </span>
    );
  }

  // The shell's SECOND slot, when not on a call — "not open" words for everyone (spec §5.6.1,
  // Technicians included: "the same words, no button"), "● Open" for whoever may change the switch
  // with no enabled profile, the idle count (F-085 part 1, spec §7.2; unchanged markup), or nothing.
  // Exactly one of the three ever applies, and this file's own test pins exactly two data-testid
  // attributes total (the string, not spelled out here on purpose) across the whole component — one
  // above, for on-a-call, one below — so the three share that ONE wrapper (`idleWords`/`closedWords`)
  // rather than each returning its own.
  let closedDotClass: string | null = null;
  let closedShort: string | null = null;
  let closedFull: string | null = null;
  if (labels) {
    closedDotClass = effective!.state === "running_late" ? "bg-[var(--warn)]" : "bg-[var(--crit)]";
    closedShort = labels.short;
    closedFull = labels.full;
  } else if (!presence && businessStatus?.canChange) {
    const openText = t(m, "business.topbar.open", locale);
    closedDotClass = "bg-[var(--good)]";
    closedShort = openText;
    closedFull = openText;
  }
  const isIdle = closedDotClass === null && !!presence && presence.showCount;
  if (closedDotClass === null && !isIdle) return null;

  const second = (
    <span data-testid="topbar-presence" lang={locale}>
      {isIdle ? idleWords(presence as ShellPresence & { showCount: true }, locale)
        : closedWords(closedDotClass!, closedShort!, closedFull!)}
    </span>
  );

  return !isIdle && businessStatus?.canChange ? (
    <BusinessStatusMenu accountId={shell!.accountId} status={businessStatus!} locale={locale} trigger={second} />
  ) : second;
}
