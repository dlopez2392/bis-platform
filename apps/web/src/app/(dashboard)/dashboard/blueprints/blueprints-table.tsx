import { Badge } from "@/components/ui/badge";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

export function BlueprintsTable({
  rows,
}: { rows: { id: string; name: string; version: number; captured: string; appliedCount: number }[] }) {
  return (
    <ListPanel as="ul">
      {rows.map((row) => (
        // No hover: these rows are genuinely static (nothing to open).
        <li key={row.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", LIST_ROW)}>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-card-foreground">{row.name}</span>
            <span className="block text-xs text-muted-foreground">
              {m["blueprints.captured"]} {row.captured}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {m["blueprints.applied"]} {row.appliedCount} {m["blueprints.appliedCount"]}
            </span>
            <Badge variant="secondary">{m["blueprints.version"]} {row.version}</Badge>
          </span>
        </li>
      ))}
    </ListPanel>
  );
}
