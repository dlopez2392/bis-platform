import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down" };
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-card-foreground">{value}</p>
      {delta ? (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            delta.direction === "up" ? "text-success" : "text-destructive",
          )}
        >
          {delta.value}
        </p>
      ) : null}
    </div>
  );
}
