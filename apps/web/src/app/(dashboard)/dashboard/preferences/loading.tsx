import { PreferencesSkeleton } from "@/components/preferences/preferences-panel";
import { DailyBriefCardSkeleton } from "@/components/preferences/daily-brief-card";

/** Rule 7: skeletons shaped like the two cards, never a spinner. */
export default function Loading() {
  return (
    <>
      <PreferencesSkeleton />
      <DailyBriefCardSkeleton />
    </>
  );
}
