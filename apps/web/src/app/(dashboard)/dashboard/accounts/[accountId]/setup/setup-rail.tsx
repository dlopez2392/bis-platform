"use client";

import { AlertTriangle, Check, Lock, Minus } from "lucide-react";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import { kindOf, type SetupStepView, type StateKind } from "@/lib/setup/setup-view";
import { SETUP_STEP_KEYS, isLockedStep, lockedPrereqKeys } from "@/lib/setup/setup-rail";
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

/** The five `kindOf` states (lib/setup/setup-view.ts) plus a sixth the RAIL
 *  layer adds on top: `locked`. Kept OUT of `StateKind` itself — that type
 *  is what every step module's own `kind` prop uses (step-shared.tsx), and
 *  none of those need to know "locked" exists; only the rail and the pane
 *  header (setup-shell.tsx) do. */
export type RailKind = StateKind | "locked";

/**
 * `kindOf`'s answer, promoted to `locked` when this step's own prerequisites
 * are unmet — but ONLY when `kindOf` didn't already answer `unknown`,
 * `done`, or `skipped`:
 *   - `unknown` stays `unknown`. A step whose OWN read failed must keep
 *     saying so — "couldn't check" is never quietly upgraded to a verdict
 *     about a DIFFERENT step's prerequisites (the correction this task
 *     brief itself exists to enforce).
 *   - `done` stays `done`. `test_call` can be done (a real call was placed)
 *     while one of its prerequisites has since gone unmet again (a voice
 *     profile cleared after the call) — the step itself is still finished;
 *     it does not retroactively need unlocking.
 *   - `skipped` stays `skipped`, for the same reason: no lockable key is
 *     ever also skippable today (`isLockedStep` only locks `test_call`/
 *     `go_live`; only `email` is ever skipped), but excluding it here keeps
 *     that true by construction rather than by coincidence.
 */
export function railKindOf(view: SetupStepView, isNext: boolean, views: SetupStepView[]): RailKind {
  const kind = kindOf(view, isNext);
  if (kind === "unknown" || kind === "done" || kind === "skipped") return kind;
  return isLockedStep(view.key, views) ? "locked" : kind;
}

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
    <ol className="space-y-1" aria-label={m["setup.title"]}>
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
              aria-current={isSelected ? "step" : undefined}
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
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                "hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                isSelected ? "border-primary/40 bg-primary/5" : "border-transparent",
              )}
            >
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
