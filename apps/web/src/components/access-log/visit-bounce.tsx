"use client";

import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";

/**
 * The router-cache loop's second guard (2026-10-30, proven from production logs). The chooser renders
 * this, instead of calling `redirect()`, when it finds a visit already live: typically one started in
 * another tab, so `startVisitAction`'s `revalidatePath` purged THAT tab's client cache, not this one's.
 * This tab may still hold prefetched "go to the chooser" redirects for the account's routes (Next keeps
 * them 300 s), and a render-time `redirect()` or a soft `router.replace` would replay them: chooser ->
 * cached redirect -> chooser. `router.refresh()` clears the client cache for the current route only
 * (Next 16.3 use-router.md), so it cannot help. A hard navigation starts with no client cache at all.
 */
export function bounceIntoAccount(target: string): void {
  window.location.replace(target);
}

/**
 * The visible way out (#308 follow-up M1): if the hard navigation never happens (a blocked script, a slow
 * device), the person is not left on a skeleton. A plain <a>, never next/link: following a Link is the soft
 * navigation that would replay the cached redirect; following an anchor is a hard one, like the bounce.
 */
export function VisitBounce({ target, label, continueLabel }: { target: string; label: string; continueLabel: string }) {
  useEffect(() => {
    bounceIntoAccount(target);
  }, [target]);
  return (
    <div className="space-y-4 p-6">
      <div role="status" data-bounce-to={target}>
        <Skeleton aria-hidden="true" className="h-4 w-48" />
        <span className="sr-only">{label}</span>
      </div>
      <a href={target} className={buttonVariants({ variant: "ghost", size: "sm" })}>{continueLabel}</a>
    </div>
  );
}
