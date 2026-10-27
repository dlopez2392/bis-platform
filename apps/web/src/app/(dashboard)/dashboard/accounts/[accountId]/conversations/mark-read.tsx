"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** The write, then a refresh of the page (a plain render) so the thread list's counts follow. A failed or
 *  refused write refreshes nothing. M7a PR-4 (review I2): the action itself no longer revalidates. */
export async function markReadThenRefresh(
  action: (conversationId: string) => Promise<void>, conversationId: string, refresh: () => void,
): Promise<void> {
  await action(conversationId);
  refresh();
}

/**
 * Fires the mark-read action once per opened thread.
 *
 * This exists as an effect rather than a call inside the page's render because
 * a render-time write would also fire on Next's link prefetch — hovering a
 * thread would clear its badge without anyone reading it.
 */
export function MarkRead({
  conversationId, unreadCount, action,
}: {
  conversationId: string;
  unreadCount: number;
  action: (conversationId: string) => Promise<void>;
}) {
  const done = useRef<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (unreadCount === 0 || done.current === conversationId) return;
    done.current = conversationId;
    void markReadThenRefresh(action, conversationId, () => router.refresh());
  }, [conversationId, unreadCount, action, router]);

  return null;
}
