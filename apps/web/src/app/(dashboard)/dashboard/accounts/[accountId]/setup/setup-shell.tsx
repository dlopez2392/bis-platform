"use client";

import { useCallback, useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import type { SetupStepView } from "@/lib/setup/setup-view";
import { parseStepParam } from "@/lib/setup/setup-rail";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { STEP_COPY } from "./steps/step-shared";
import { SetupRail, STATE_LABEL, STATE_TONE, railKindOf, lockedHint } from "./setup-rail";

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
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, key);
    window.history.pushState(window.history.state, "", url);
    notify(); // pushState does not fire popstate — subscribers must be told directly
  }, []);

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
  const index = views.findIndex((v) => v.key === selected);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <SetupRail
        views={views}
        selected={selected}
        nextKey={nextKey}
        blockedReason={blockedReason}
        onSelect={select}
      />

      <div className="min-w-0 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-widest text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="text-base font-semibold text-card-foreground">{copy.title}</h2>
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
          <div
            role="note"
            className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{lockedHint(selected, views, blockedReason)}</p>
          </div>
        ) : null}

        {details[selected]}
      </div>
    </div>
  );
}
