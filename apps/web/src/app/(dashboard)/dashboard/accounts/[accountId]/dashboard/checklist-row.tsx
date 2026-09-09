// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/checklist-row.tsx
//
// The dashboard's stand-in for the full /checklist section (danlo,
// 2026-09-09): before this, the dashboard rendered the SAME ChecklistPanel
// the /checklist route renders — identical data, identical toggle/add-item
// actions, a whole nav section duplicated on a page that already has one.
// This is a single row instead: it keeps the nudge (what's left, where to
// go) without carrying a second copy of that section. The completed state
// (nothing left) is unrelated to this component — page.tsx keeps rendering
// its existing small text link in that case, unchanged.
//
// Visual language borrowed from the sidebar footer's own setup-progress
// affordance (`SetupMeterLink`, app-sidebar.tsx) — same shape: one Link
// wrapping a label+count row over a bar, the whole row is the click target,
// and the count carries the accessible name (an aria-label on the Link, not
// a labelled span inside it — SetupMeterLink's own rule). The bar itself
// uses the shared CONTENT-area meter tokens (`METER_TRACK`/`METER_FILL` from
// meter.tsx) rather than the sidebar's own chrome gradient: this row lives
// in the main content area, and a themed tenant re-points `--accent` but
// not `--sidebar-*` (meter.tsx's own comment on exactly this distinction).
import Link from "next/link";
import { METER_TRACK, METER_FILL } from "@/components/meter";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";

export function ChecklistRow({
  accountId,
  /** Items whose `done` is true — page.tsx's own `checklistEntries` minus
   *  `checklistRemaining`. */
  done,
  /** Full catalogue length — `checklistEntries.length`. */
  total,
}: {
  accountId: string;
  done: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const progressText = m["checklist.dashboardProgress"]
    .replace("{done}", String(done))
    .replace("{total}", String(total));

  return (
    <Link
      href={`/dashboard/accounts/${accountId}/checklist`}
      aria-label={`${m["checklist.title"]} (${progressText})`}
      // Same clickable-card language as the agency's own accounts grid
      // (accounts/page.tsx) — the established "block card, hover:border
      // accent" affordance for a row whose entire body is one link.
      className="block max-w-2xl rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3 transition-colors hover:border-[var(--accent)]"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-card-foreground">{m["checklist.title"]}</span>
        {/* The mono label role — same treatment as SetupMeterLink's own
            done/total count. */}
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{progressText}</span>
      </span>
      {/* Purely decorative — the Link's own aria-label above already carries
          the count in words, and an explicit aria-label on the Link
          overrides name-from-content entirely, so the visible text spans
          above need no aria-hidden of their own. Only this bar has nothing
          a screen reader could read (it is a styled width, not text). */}
      <span className={cn(METER_TRACK, "mt-2.5")} aria-hidden>
        <span className={cn("block h-full rounded-full", METER_FILL)} style={{ width: `${percent}%` }} />
      </span>
    </Link>
  );
}
