import { Skeleton } from "@/components/ui/skeleton";
import { SuggestionSectionSkeleton } from "@/components/proposals/suggestion-section";
import { makeTr } from "@/lib/record/copy";

/** Shaped like the real layout (DESIGN.md rule 7: no spinners) — same idiom
 *  as tasks/loading.tsx, this screen's per-account sibling, including the
 *  suggestions' grouped card skeleton (item 8b-2). A loading file reads no
 *  person's language, so its one line of words is English. */
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
        <SuggestionSectionSkeleton tr={makeTr("en")} grouped />
      </div>
    </div>
  );
}
