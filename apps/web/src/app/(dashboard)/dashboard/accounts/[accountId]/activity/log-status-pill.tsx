import type { AutomationLogStatus } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";

/** Dot + word, the Calls page's OutcomePill shape, for the four log statuses:
 *  the shared `DotPill` wearing `STATUS_TREATMENTS`, at its roomier padding. */
export function LogStatusPill({ status }: { status: AutomationLogStatus }) {
  const t = STATUS_TREATMENTS[status];
  return <DotPill label={t.label} chip={t.chip} dot={t.dot} data-status={status} />;
}
