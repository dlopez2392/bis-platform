import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the real page (DESIGN.md rule 7, no spinners): the header,
 *  then plan rows, the same idiom as numbers/loading.tsx. */
export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="overflow-hidden rounded-xl border border-border" aria-busy="true" aria-label="Loading">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[108px] rounded-none" />)}
      </div>
    </div>
  );
}
