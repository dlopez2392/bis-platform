import { Badge } from "@/components/ui/badge";
import { m } from "@/lib/messages";

export function BlueprintsTable({
  rows,
}: { rows: { id: string; name: string; version: number; captured: string; appliedCount: number }[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-card-foreground">{row.name}</span>
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
    </ul>
  );
}
