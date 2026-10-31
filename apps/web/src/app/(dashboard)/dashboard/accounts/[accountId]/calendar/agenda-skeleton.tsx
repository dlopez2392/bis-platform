import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** F-046 part 1 (spec 5.6, rule 7): the Agenda card while it streams, its header and five rows shaped like
 *  Day rows (a time and a name, then a line of detail). No spinner. */
export function AgendaSkeleton() {
  return (
    <section data-agenda-skeleton aria-hidden className="rounded-xl border border-border bg-card glass">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-5 w-24 rounded-[var(--radius-ctl)]" />
          <Skeleton className="h-8 w-32 rounded-[var(--radius-ctl)]" />
          <Skeleton className="ml-auto h-9 w-24 rounded-[var(--radius-ctl)]" />
        </div>
        <Skeleton className="h-4 w-56 rounded-[var(--radius-ctl)]" />
      </div>
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} data-agenda-skeleton-row className="space-y-2 rounded-[var(--radius-ctl)] bg-[var(--surface-2)] px-3 py-2.5">
            <Skeleton className={cn("h-4 rounded-[var(--radius-ctl)]", i % 2 === 0 ? "w-1/2" : "w-2/3")} />
            <Skeleton className="h-3 w-1/3 rounded-[var(--radius-ctl)]" />
          </div>
        ))}
      </div>
    </section>
  );
}
