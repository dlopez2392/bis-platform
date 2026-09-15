import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the real layout (DESIGN.md rule 7: no spinners) — same idiom
 *  as tasks/loading.tsx, this screen's per-account sibling. */
export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="space-y-6" aria-busy="true" aria-label="Loading">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16 rounded" />
          <div className="space-y-0 overflow-hidden rounded-xl border border-border">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] rounded-none" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
