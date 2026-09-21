import type { AutomationLogStatus } from "@bis/db";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";

/** Dot + word, the Calls page's OutcomePill shape, for the four log statuses. */
export function LogStatusPill({ status }: { status: AutomationLogStatus }) {
  const t = STATUS_TREATMENTS[status];
  return (
    <Badge variant="chip" className={cn("gap-1.5 py-1 pr-2.5 pl-2", t.chip)} data-status={status}>
      <span className={cn("size-[7px] rounded-full", t.dot)} aria-hidden />
      {t.label}
    </Badge>
  );
}
