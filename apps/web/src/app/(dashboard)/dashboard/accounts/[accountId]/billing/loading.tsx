import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the page (DESIGN rule 7, no spinners): the header, then one
 *  card with the plan name and status, the price, three usage lines and the
 *  Manage billing button. The same idiom as plans/loading.tsx. */
export default function Loading() {
  return (
    <div className="p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="space-y-3 rounded-xl border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-28" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-44" />)}
        <Skeleton className="h-9 w-36" />
      </div>
    </div>
  );
}
