"use client";

import { useCallback, useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import type { SetupStepView } from "@/lib/setup/setup-view";
import {
  SETUP_STEP_KEYS, parseStepParam, lockedPrereqKeys, railKindOf,
} from "@/lib/setup/setup-rail";
import { cn } from "@/lib/utils";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { STEP_COPY } from "./steps/step-shared";
import {
  SetupRail, STATE_LABEL, STATE_TONE, SETUP_PANE_ID, SETUP_PANE_HEADING_ID,
} from "./setup-rail";

const PARAM = "step";

// URL is the single source of truth; this store bridges it into React.
// Modeled directly on apps/web/src/lib/contacts/use-peek.ts (P4), hardened
// through two fix waves there — same shape here: module-level listener set,
// `subscribe` also listens to `popstate`, `notify()` after pushState (which
// does not itself fire popstate), server snapshot `null`.
const listeners = new Set<() => void>();
function notify() { for (const l of listeners) l(); }
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => { listeners.delete(cb); window.removeEventListener("popstate", cb); };
}
function readStep(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM);
}

/**
 * `?step=` mirrored into React, never duplicated into a `useState` (this
 * repo's `react-hooks/set-state-in-effect` is an ERROR-level rule, and a
 * second copy synced from an effect is exactly the shape it exists to
 * catch). `parseStepParam` (lib/setup/setup-rail.ts) resolves both the
 * server snapshot (`null`) and any unknown/malformed value to the same
 * default — the first not-done step — so there is never a render with no
 * step selected.
 *
 * `select` uses `pushState`, not `router.push`: the latter would re-render
 * the whole server component tree on every rail click, which is the exact
 * cost this two-pane shell exists to avoid (`details` below is already
 * fully computed server-side for all nine steps — a step click only ever
 * needs to change which one is DISPLAYED). `pushState` also means Back
 * walks steps one at a time, same as forward navigation through the rail.
 */
export function useSetupStep(views: SetupStepView[]) {
  const raw = useSyncExternalStore(subscribe, readStep, () => null);
  const selected = parseStepParam(raw, views);

  const select = useCallback((key: SetupStepKey) => {
    // Re-selecting the step already on screen would push a SECOND identical
    // history entry. Nothing on screen changes, but the next Back press then
    // lands on the same step — a Back button that visibly does nothing.
    if (key === selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, key);
    window.history.pushState(window.history.state, "", url);
    notify(); // pushState does not fire popstate — subscribers must be told directly
  }, [selected]);

  return { selected, select };
}

/**
 * The two-pane wizard: the rail (./setup-rail.tsx) on the left, one step's
 * detail on the right. This is the ONLY client boundary the wizard needs —
 * everything in `details` was rendered server-side by setup-panel.tsx from
 * props already in hand; this component just decides which one to place in
 * the tree. Server Components passed as pre-rendered nodes into a Client
 * Component's props is the standard RSC composition for exactly this case.
 */
export function SetupShell({
  views, nextKey, blockedReason, details,
}: {
  views: SetupStepView[];
  /** Same value setup-panel.tsx already computed for the "Next up" badge —
   *  passed down rather than re-derived here, so the rail's "Current" word
   *  and each step module's own `kind` prop (computed server-side) can
   *  never disagree about which step is next. */
  nextKey: SetupStepKey | null;
  /** go_live's own blocked sentence, computed once for the whole page by
   *  setup-panel.tsx — reused for its banner rather than deriving a second
   *  string (see setup-rail.tsx's `lockedHint`). */
  blockedReason: string | null;
  /** One pre-rendered node per step. All nine exist as React elements;
   *  only the selected key's is ever placed into the returned tree, so the
   *  other eight are computed but never mounted. */
  details: Record<SetupStepKey, React.ReactNode>;
}) {
  const { selected, select } = useSetupStep(views);
  const view = views.find((v) => v.key === selected);
  // Unreachable in practice: `parseStepParam` only ever returns a key that
  // exists in `SETUP_STEP_KEYS`, and `views` always carries all nine — kept
  // as a typed guard rather than a non-null assertion.
  if (!view) return null;

  const kind = railKindOf(view, selected === nextKey, views);
  const locked = kind === "locked";
  const copy = STEP_COPY[selected];
  // Same source as the rail's own numbering (setup-rail.tsx maps over
  // SETUP_STEP_KEYS). Deriving this one from `views` instead would let the
  // pane say "04" while the rail entry it came from says "05" the moment
  // the two lists ever disagree on order or length.
  const index = SETUP_STEP_KEYS.indexOf(selected);

  // The blockers as KEYS, not a pre-joined sentence: naming what blocks this
  // step and then making the operator find it again in the rail is half the
  // answer. Each one is a button that selects that step.
  const blockerKeys = locked ? lockedPrereqKeys(selected, views) : [];
  // `setup.locked.blockedBy` carries its list in a `{steps}` slot; splitting
  // on that slot lets the BUTTONS occupy it instead of a joined string — the
  // same technique SetupProgress (setup-panel.tsx) uses on its own
  // `{done}`/`{total}` placeholders.
  const [blockedLead = "", blockedTail = ""] = m["setup.locked.blockedBy"].split("{steps}");

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <SetupRail
        views={views}
        selected={selected}
        nextKey={nextKey}
        blockedReason={blockedReason}
        onSelect={select}
      />

      {/* `role="region"` + `aria-labelledby`, not a bare `id`: the rail's
          `aria-controls` needs a target, and a target worth jumping to has to
          be findable and named. The heading below supplies the name, so the
          region announces as "Business hours, region" — the same words the
          operator just clicked. */}
      <div
        id={SETUP_PANE_ID}
        role="region"
        aria-labelledby={SETUP_PANE_HEADING_ID}
        className="min-w-0 rounded-xl border border-border bg-card glass p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-widest text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 id={SETUP_PANE_HEADING_ID} className="text-base font-semibold text-card-foreground">
                {copy.title}
              </h2>
              {kind === "next" ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                  {m["setup.nextUp"]}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{copy.help}</p>
          </div>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
              STATE_TONE[kind].chip,
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", STATE_TONE[kind].dot)} aria-hidden />
            {STATE_LABEL[kind]}
          </span>
        </div>

        {locked ? (
          <Notice
            tone="warn"
            role="note"
            // Prose is `text-foreground`, NOT `text-warning`. `--warning`
            // measures ~3.6:1 on this surface: over the 3:1 bar a dot, ring
            // or ICON has to clear, under AA for a LABEL. Exactly why every
            // state chip keeps its text foreground and puts the hue in the
            // dot and the border (TONE.unknown.chip, steps/step-shared.tsx)
            // — the hue now stays on this banner's tinted GROUND and its
            // icon, since the mockup's status shape gives it no border.
            className="mt-3 flex items-start gap-2 text-foreground"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 space-y-1.5">
              {/* ONE presentation for both locked panes: the lead-in sentence,
                  then each blocker as a button that selects it.

                  `go_live` used to ALSO print `blockedReason` — the same
                  sentence with the same step titles comma-joined inside it —
                  immediately above the buttons, so an operator on the pane
                  they see most read every blocker twice and it looked like a
                  rendering bug. `test_call` never did. The duplication was the
                  odd one out, not the lead-in, so the lead-in is what both
                  panes keep: it is the half that says what to DO, and the
                  buttons are strictly more useful than the comma list they
                  duplicated (naming a blocker and then making the operator
                  hunt for it in the rail is half an answer).

                  `blockedReason` is still the RAIL's go_live hint
                  (setup-rail.tsx's `lockedHint`), where a compact sentence
                  under the entry is the right shape and there are no buttons
                  to carry the names — which is why it is still a prop here
                  and still passed down. */}
              {blockerKeys.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{blockedLead}</span>
                  {blockerKeys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => select(key)}
                      // The blocker chips sit INSIDE the detail pane, so a
                      // card fill here was a mini card-on-card. They take the
                      // mockup's neutral chip instead — never glass (nested).
                      className={cn(
                        "rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-medium text-[var(--chip-text)]",
                        "transition-colors hover:bg-[var(--surface-3)]",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                      )}
                    >
                      {STEP_COPY[key].title}
                    </button>
                  ))}
                  {blockedTail ? <span>{blockedTail}</span> : null}
                </div>
              ) : null}
            </div>
          </Notice>
        ) : null}

        {details[selected]}
      </div>
    </div>
  );
}
