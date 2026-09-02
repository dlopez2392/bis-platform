import { SetupGoLiveButton } from "../setup-go-live-button";
import type { StepDetailProps } from "./step-shared";

export function GoLiveStep({
  step, goLiveAction, prereqsMet, blockedReason,
}: StepDetailProps): React.ReactNode {
  const rows: React.ReactNode[] = [];

  if (!step.done) {
    rows.push(
      // `disabled` is courtesy only. goLiveAction re-derives every
      // prerequisite from live rows at click time and refuses on its own
      // evidence, which is why it is safe to drive this attribute from a
      // render that went stale the moment it painted.
      <SetupGoLiveButton key="golive" action={goLiveAction} disabled={!prereqsMet} />,
    );
  }

  // Scoped to the go-live card: `blockedReason` is computed once for the
  // whole panel, so testing it alone here would give every other card an
  // empty action row.
  const showReason = !step.done && !prereqsMet && blockedReason !== null;

  if (rows.length === 0 && !showReason) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">{rows}</div>
      ) : null}
      {/* Visible, not a tooltip: a disabled button takes no pointer events in
          several browsers and is out of the tab order, so `title` alone would
          hide the one sentence that says what is still missing. */}
      {showReason ? <p className="text-sm text-muted-foreground">{blockedReason}</p> : null}
    </div>
  );
}
