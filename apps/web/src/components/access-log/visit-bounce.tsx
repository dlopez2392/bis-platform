"use client";

import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

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

export function VisitBounce({ target, label }: { target: string; label: string }) {
  useEffect(() => {
    bounceIntoAccount(target);
  }, [target]);
  return (
    <div role="status" data-bounce-to={target} className="p-6">
      <Skeleton aria-hidden="true" className="h-4 w-48" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
