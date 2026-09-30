"use client";

import { AlertTriangle, Check, Lock, Minus } from "lucide-react";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import type { SetupStepView } from "@/lib/setup/setup-view";
import {
  SETUP_STEP_KEYS, lockedPrereqKeys, railKindOf, type RailKind,
} from "@/lib/setup/setup-rail";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { STEP_COPY, TONE } from "./steps/step-shared";

/**
 * The stepper rail — DESIGN.md's "stepper rail (done ✓ / current / todo /
 * locked-with-reason) + one step detail pane". Every entry is always a real
 * `<button>`, including locked ones (spec decision: a locked step must stay
 * reachable so its pane can explain why, rather than being dead weight in
 * the list). Selection itself lives in ./setup-shell.tsx — this file only
 * renders the rail and reports clicks upward via `onSelect`.
 */

/**
 * The step-detail pane's element ids, declared HERE — beside the
 * `aria-controls` that points at them — rather than in the file that renders
 * the pane (./setup-shell.tsx). A dangling `aria-controls` is worse than no
 * linkage at all (AT announces a relationship to nothing), so the id and the
 * reference to it share one constant instead of two string literals that
 * agree today. Static, not generated: exactly one wizard renders per page.
 */
export const SETUP_PANE_ID = "setup-step-pane";
/** The pane's `<h2>`, which is also what names the pane region. */
export const SETUP_PANE_HEADING_ID = "setup-step-heading";

/** Status is never colour alone (DESIGN.md rule 3) — every rail entry and
 *  the pane header (setup-shell.tsx) both read off this single map, so the
 *  word can never drift between the two surfaces. */
export const STATE_LABEL: Record<RailKind, string> = {
  done: m["setup.state.done"],
  open: m["setup.state.open"],
  next: m["setup.state.next"],
  skipped: m["setup.state.skipped"],
  unknown: m["setup.state.unknown"],
  locked: m["setup.state.locked"],
};

/** `TONE`'s five entries (step-shared.tsx) plus `locked` — dashed border and
 *  muted colour, matching how `skipped` already reads (intentional, not
 *  urgent), distinguished from it by the Lock icon and the word alone. */
export const STATE_TONE: Record<RailKind, { marker: string; chip: string; dot: string }> = {
  done: TONE.done,
  open: TONE.open,
  next: TONE.next,
  skipped: TONE.skipped,
  unknown: TONE.unknown,
  locked: {
    marker: "border-dashed border-border bg-muted text-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

const ICON: Partial<Record<RailKind, React.ComponentType<{ className?: string }>>> = {
  done: Check,
  skipped: Minus,
  unknown: AlertTriangle,
  locked: Lock,
};

/**
 * The reason line shown for a locked step, in both the rail (a compact hint
 * under the entry) and the pane (setup-shell.tsx's banner above the body) —
 * ONE derivation, so the two can never name different blockers.
 *
 * `go_live` reuses `blockedReason` — the sentence setup-panel.tsx already
 * computed once for the whole page (`m["setup.goLive.blocked"]`) and which
 * already treats an UNKNOWN prerequisite as unmet — rather than deriving a
 * second string from `lockedPrereqKeys("go_live", ...)` that happens to name
 * the same steps. `test_call` has no such precomputed sentence (nothing
 * else on this page needed one before this task), so it builds its own from
 * `lockedPrereqKeys` + `STEP_COPY[...].title`, via `setup.locked.blockedBy`.
 */
export function lockedHint(
  key: SetupStepKey, views: SetupStepView[], blockedReason: string | null,
): string | null {
  if (key === "go_live") return blockedReason;
  const names = lockedPrereqKeys(key, views).map((k) => STEP_COPY[k].title);
  if (names.length === 0) return null;
  return m["setup.locked.blockedBy"].replace("{steps}", names.join(", "));
}

export function SetupRail({
  views, selected, nextKey, blockedReason, onSelect,
}: {
  views: SetupStepView[];
  selected: SetupStepKey;
  /** The single step the pane badges "Next up" — computed once by
   *  setup-panel.tsx from `views` alone (no dependency on selection), so
   *  the rail's "Current" word and each step module's own `kind` prop can
   *  never name a different step as next. */
  nextKey: SetupStepKey | null;
  blockedReason: string | null;
  onSelect: (key: SetupStepKey) => void;
}) {
  return (
    <ol
      // Sticky, which the P5 spec's Layout section asks for ("stepper rail
      // (~260px, sticky)" —
      // docs/superpowers/specs/2026-09-02-design-phase5-setup-wizard-design.md;
      // DESIGN.md itself says nothing about a rail) and the plain grid did
      // not give: ten entries plus
      // three locked hints is taller than a laptop viewport's content area, so
      // scrolling the pane scrolled the rail away with it and the operator
      // lost the map of where they were.
      //
      // `lg:` only — below that breakpoint setup-shell.tsx's grid is a single
      // column and the rail sits ABOVE the pane, where sticking it would pin
      // a 500px block over the content the operator is reading.
      //
      // `self-start` is load-bearing: a grid item stretches to its row by
      // default, which makes `position: sticky` a no-op because the element is
      // already as tall as the thing it would stick within.
      //
      // The bounded height plus `overflow-y-auto` is what keeps the LAST
      // entries reachable on a short viewport — sticky alone would just pin a
      // rail whose bottom is off-screen forever. `px-1` pays for the entries'
      // 2px `focus-visible` ring: `overflow-y: auto` computes `overflow-x` to
      // `auto` too, so without the padding a focused entry's ring would raise
      // a horizontal scrollbar.
      className="space-y-1 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:px-1"
      // NOT `setup.title` — that is the page's own <h1>, and a list whose
      // accessible name repeats the heading it sits under makes a screen
      // reader announce "Client setup" twice for two different things.
      aria-label={m["setup.railLabel"]}
    >
      {SETUP_STEP_KEYS.map((key, index) => {
        const view = views.find((v) => v.key === key);
        if (!view) return null; // SETUP_STEP_KEYS and `views` always agree in practice
        const kind = railKindOf(view, key === nextKey, views);
        const tone = STATE_TONE[kind];
        const Icon = ICON[kind];
        const isSelected = key === selected;
        const hint = kind === "locked" ? lockedHint(key, views, blockedReason) : null;

        return (
          <li key={key}>
            <button
              type="button"
              // `"true"`, NOT `"step"`. `aria-current="step"` means "this is
              // the current step in a process", and on this rail that is a
              // DIFFERENT entry from the selected one: the visible word
              // "Current" (STATE_LABEL.next) marks `nextKey` — the first
              // outstanding step — while selection is wherever the operator
              // clicked. With `"step"` here a screen reader announced "Go
              // live, current step" while the Current chip sat on Business
              // hours. `aria-current="true"` says only "this is the selected
              // one in this set", which is exactly what selection is.
              // The string literal, not the boolean: React does render
              // `aria-current={true}` as `aria-current="true"`, but the e2e
              // asserts that exact attribute VALUE, and spelling it out here
              // means the assertion is reading what this file says rather
              // than a serialization rule two layers away.
              aria-current={isSelected ? "true" : undefined}
              // Selecting an entry swaps the pane's entire contents with no
              // navigation and no focus change (deliberately — see the
              // ArrowDown handler below: focus browsing and selection are
              // separate here, and yanking focus into the pane on every rail
              // click would make arrow-key browsing impossible). Without a
              // programmatic link, that swap is silent to assistive tech.
              // `aria-controls` supplies it: every entry points at the one
              // pane it changes, so AT can offer a jump to the thing that
              // just changed instead of the operator having to find it.
              aria-controls={SETUP_PANE_ID}
              onClick={() => onSelect(key)}
              // Same shape as contacts-table.tsx's row keydown handler: the
              // guard is a no-op here (this button has no interactive
              // children to distinguish from), kept for the same reason
              // that precedent keeps it — a future addition to the entry
              // (a tooltip trigger, say) shouldn't silently start stealing
              // arrow keys from rail navigation.
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(key); }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const li = e.currentTarget.closest("li");
                  const sibling = e.key === "ArrowDown" ? li?.nextElementSibling : li?.previousElementSibling;
                  const next = sibling?.querySelector("button");
                  if (next instanceof HTMLElement) next.focus();
                }
              }}
              // The stepper is the same "active item in a vertical list" the
              // sidebar already solved: --accent-dim ground, a transparent
              // edge, and the 3px gradient rail — not an alpha of the brand
              // colour used as an outline.
              className={cn(
                "relative flex w-full items-start gap-2.5 rounded-[var(--radius-ctl)] border px-2.5 py-2 text-left transition-colors",
                "hover:bg-[var(--surface-3)] focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                isSelected ? "border-transparent bg-[var(--accent-dim)]" : "border-transparent",
              )}
            >
              {isSelected ? (
                <span
                  data-slot="step-rail"
                  className="absolute inset-y-[7px] left-0 w-[3px] rounded-[3px] bg-[linear-gradient(var(--accent),var(--accent-2))]"
                  aria-hidden
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium tabular-nums",
                  tone.marker,
                )}
              >
                {Icon ? <Icon className="size-3.5" /> : String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {STEP_COPY[key].title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
                  {STATE_LABEL[kind]}
                </span>
                {/* The mockup's own rule (docs/design/bis-design-direction.html):
                    "steps that depend on others ... show why they're locked,
                    in plain words, right on the rail" — not just the word
                    "Locked", which names THAT it's blocked but not by what. */}
                {hint ? (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
