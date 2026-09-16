import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the real layout (DESIGN.md rule 7: no spinners) — the header,
 *  the count strip, then the rows — same idiom as work/loading.tsx, this
 *  screen's top-level sibling. */
export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-[62px] rounded-xl" />
        <div className="space-y-0 overflow-hidden rounded-xl border border-border">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[58px] rounded-none" />)}
        </div>
      </div>
    </div>
  );
}
