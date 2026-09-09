// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/outcome-pill.tsx
//
// The outcome badge — dot + word (DESIGN.md rule 3: status is never color
// alone) — shared by every surface that shows a call's outcome: the list
// (calls-table.tsx), the detail page ([callId]/page.tsx), and the
// dashboard's recent-calls mini table (../dashboard/calls-chart-card.tsx,
// Task 6). This exact JSX used to be duplicated byte-for-byte between the
// first two, the same "defined twice with a comment asking a reviewer to
// keep them in sync" shape `OUTCOMES` itself (format.ts) already documents
// having outgrown — pulled out here rather than left to drift a third time.
import type { CallOutcome } from "@bis/db";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OUTCOMES } from "./format";

export function OutcomePill({ outcome }: { outcome: CallOutcome }) {
  const treatment = OUTCOMES[outcome];
  return (
    // `chip`, not `outline`: `outline`'s ground is `--surface-3` (.09) — the
    // hover/raised step of the ladder used as a resting fill. The mockup's
    // neutral `.chip` (northern-lights.html:147) is `--chip-bg` (.05) with its
    // own 1px edge, and the outcomes that deliberately recede (abandoned,
    // spam) now recede onto that instead of onto a raised surface.
    <Badge variant="chip" className={cn("gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
      {/* 7px, the mockup's `.chip i` (148) — 6px reads as a speck at this
          text size, and the dot is the whole of DESIGN.md rule 3 here. */}
      <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
      {treatment.label}
    </Badge>
  );
}
