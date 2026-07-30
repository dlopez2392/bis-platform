"use client";

import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (unreadCount === 0 || done.current === conversationId) return;
    done.current = conversationId;
    void action(conversationId);
  }, [conversationId, unreadCount, action]);

  return null;
}
