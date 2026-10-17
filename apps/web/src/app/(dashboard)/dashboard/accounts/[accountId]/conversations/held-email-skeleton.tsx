import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LIST_ROW } from "@/components/ui/list-panel";

/** Rule 7: three rows shaped like `HeldEmailList`'s own article (two lines
 *  of text, the reason line, the excerpt, then a button-sized bar), never a
 *  spinner. */
export function HeldEmailSkeleton() {
  return (
    <div data-held-skeleton aria-hidden="true" className="overflow-hidden rounded-xl border border-border">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn("flex flex-col gap-2 px-3 py-3", LIST_ROW)}>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className={cn("h-4 rounded-[var(--radius-ctl)]", i === 1 ? "w-1/3" : "w-1/2")} />
            <Skeleton className="h-3 w-16 rounded-[var(--radius-ctl)]" />
          </div>
          <Skeleton className="h-3 w-2/3 rounded-[var(--radius-ctl)]" />
          <Skeleton className="h-3 w-1/3 rounded-[var(--radius-ctl)]" />
          <Skeleton className="h-3 w-5/6 rounded-[var(--radius-ctl)]" />
          <Skeleton className="h-8 w-28 rounded-[var(--radius-ctl)]" />
        </div>
      ))}
    </div>
  );
}
