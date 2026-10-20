import { Skeleton } from "@/components/ui/skeleton";

/**
 * "Waiting for you" while the record page loads (item 8b-2, spec 5.3; rule 7): two flat rows shaped like
 * a suggestion row (the change, the evidence, the two ghost buttons), above What's next's own skeleton.
 * Its own file, with no words and no actions, because the record page's loading file is a client
 * component and must not pull the row's server-side imports into the browser.
 */
export function WaitingSuggestionsSkeleton() {
  const line = "rounded-[var(--radius-ctl)]";
  return (
    <div data-waiting-skeleton aria-hidden className="flex flex-col border-b border-[var(--row-line)] pb-2">
      <Skeleton className={`mb-1 h-3 w-24 ${line}`} />
      {[0, 1].map((i) => (
        <div key={i} data-waiting-skeleton-row className="flex flex-col gap-1.5 border-t border-[var(--row-line)] py-2.5 first:border-t-0">
          <Skeleton className={`h-4 w-4/5 ${line}`} />
          <Skeleton className={`h-3 w-3/5 ${line}`} />
          <div className="flex flex-wrap gap-2">
            <Skeleton className={`h-8 w-16 ${line}`} />
            <Skeleton className={`h-8 w-16 ${line}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
