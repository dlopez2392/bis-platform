import type { PhoneNumberStatus } from "@bis/db";
import { LIST_PANEL } from "@/components/ui/list-panel";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import {
  NUMBER_STATUS_DOT, NUMBER_STATUS_LABEL, NUMBER_STATUS_ORDER,
} from "@/lib/voice/number-status";
import type { StatusCounts } from "@/lib/voice/number-inventory";

/**
 * The inventory's total, with the only context that makes it mean anything:
 * how many of those numbers are actually answering a phone.
 *
 * Deliberately not four KPI tiles. These are small counts an operator reads
 * in passing on the way to a row, not the screen's headline — the Display
 * role (30px, -.03em) belongs to numbers that ARE the point of a screen, and
 * borrowing it here would make "0 provisioned" shout louder than the list.
 *
 * Server component: nothing here is interactive.
 */
export function StatusCountStrip({
  total, counts,
}: {
  total: number;
  counts: StatusCounts;
}) {
  return (
    <div className={cn(LIST_PANEL, "flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3")}>
      <Cell label={m["numbers.inventory"]} value={total} />
      {NUMBER_STATUS_ORDER.map((status) => (
        <Cell
          key={status}
          label={NUMBER_STATUS_LABEL[status]}
          value={counts[status]}
          status={status}
        />
      ))}
    </div>
  );
}

function Cell({
  label, value, status,
}: {
  label: string;
  value: number;
  /** Omitted for the total, which is not a status and takes no dot. */
  status?: PhoneNumberStatus;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* DESIGN.md's Label role: Geist Mono 500, 10px, +0.14em, uppercase. */}
      <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {status ? (
          // Rule 3 — dot AND word. The dot is never the only carrier of the
          // status here; the word it sits beside is the same one every row
          // below uses.
          <span className={cn("size-1.5 shrink-0 rounded-full", NUMBER_STATUS_DOT[status])} aria-hidden />
        ) : null}
        {label}
      </span>
      <span className="text-lg font-medium text-card-foreground tabular-nums">{value}</span>
    </div>
  );
}
