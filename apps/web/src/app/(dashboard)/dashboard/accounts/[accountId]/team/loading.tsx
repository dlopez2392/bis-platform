import { Skeleton } from "@/components/ui/skeleton";
import { TeamSkeleton } from "@/components/team/team-card";
import { m } from "@/lib/messages";

/** Shaped like the loaded page (rule 7, no spinners): the header, then the
 *  same TeamSkeleton the page's own Suspense boundary falls back to. */
export default function Loading() {
  return (
    <div className="p-6" aria-busy="true" aria-label={m["team.loading"]}>
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <TeamSkeleton />
    </div>
  );
}
