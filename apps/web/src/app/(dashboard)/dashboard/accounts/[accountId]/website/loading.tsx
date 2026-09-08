import { Skeleton } from "@/components/ui/skeleton";

/** Skeletons shaped like the real layout (DESIGN.md rule 7: no spinners), so
 *  nothing jumps when the numbers land. Also the body of the "waiting" state. */
export function WebsiteSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)}
      </div>
      <Skeleton className="h-[220px] rounded-lg" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[228px] rounded-lg" />)}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-4 h-[76px] rounded-lg" />
      <WebsiteSkeleton />
    </div>
  );
}
