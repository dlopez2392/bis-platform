import { CheckinCountsView, CheckinCountsSkeleton, type CheckinCountsState } from "@/app/(dashboard)/dashboard/accounts/[accountId]/automations/checkin-counts";

/**
 * F-072 PR 4: the Review requests card's check-in counts line in every state (DESIGN.md's definition of done):
 * loading, empty, loaded, error. Nothing here reads the database; the numbers are fixed and fake. Each column is
 * w-full and min-w-0, so at 375px the line wraps rather than widening the page.
 */
export const CHECKIN_COUNTS_SECTION = "Check-in counts (Review requests card)";

/** Data, not JSX copy: the labels are the styleguide's own captions (the i18n ratchet scans JSX only). */
export const CHECKIN_COUNTS_DEMOS: { id: string; label: string; state: CheckinCountsState | null }[] = [
  { id: "loading", label: "Loading, shaped like the line", state: null },
  { id: "empty", label: "Empty, says what will appear", state: { kind: "loaded", counts: { asked: 0, answered: 0, great: 0, okay: 0, notGreat: 0, opened: 0 } } },
  { id: "loaded", label: "Loaded", state: { kind: "loaded", counts: { asked: 9, answered: 6, great: 3, okay: 2, notGreat: 1, opened: 4 } } },
  { id: "error", label: "Error, never a zero", state: { kind: "error" } },
];

export function CheckinCountsStates() {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-start gap-6">
      {CHECKIN_COUNTS_DEMOS.map((d) => (
        <div key={d.id} className="flex w-full max-w-md min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{d.label}</span>
          {d.state ? <CheckinCountsView state={d.state} /> : <CheckinCountsSkeleton />}
        </div>
      ))}
    </div>
  );
}
