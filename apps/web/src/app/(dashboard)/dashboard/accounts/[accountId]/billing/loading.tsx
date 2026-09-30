import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the loaded page (DESIGN rule 7, no spinners), line for line:
 *  the header, then one card with the plan name and status pill, the price,
 *  the "Your usage" heading, three usage lines, the mono "Since" label, the
 *  chats note, the next-invoice line, and the Manage billing button with its
 *  help line. The same idiom as plans/loading.tsx. */
export default function Loading() {
  return (
    <div className="p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="flex flex-col gap-4 rounded-xl border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-28" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-44" />)}
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="h-4 w-36" />
        <div className="flex flex-col items-start gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </div>
    </div>
  );
}
