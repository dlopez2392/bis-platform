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
    <Badge variant="outline" className={cn("gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
      <span className={cn("size-1.5 rounded-full", treatment.dot)} aria-hidden />
      {treatment.label}
    </Badge>
  );
}
