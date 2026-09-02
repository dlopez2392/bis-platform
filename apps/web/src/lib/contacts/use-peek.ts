"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

const PARAM = "peek";

// URL is the single source of truth; this store bridges it into React.
// pushState/replaceState don't fire popstate, so open/close notify manually.
const listeners = new Set<() => void>();
function notify() { for (const l of listeners) l(); }
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => { listeners.delete(cb); window.removeEventListener("popstate", cb); };
}
function readPeek(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM);
}

/**
 * Drawer open-state mirrored into `?peek=<id>` with SHALLOW history calls —
 * never router.push, which would re-render the server component tree on
 * every open/close. Back closes an open drawer (we pushed one entry);
 * refresh with ?peek= present re-opens after hydration; close() goes back
 * IF this hook pushed, else (deep-linked arrival) strips the param in
 * place. useSyncExternalStore keeps the URL as the single source of truth
 * (no state duplication, SSR snapshot is null → hydration-safe).
 */
export function usePeek() {
  const peekId = useSyncExternalStore(subscribe, readPeek, () => null);
  const pushed = useRef(false);

  const open = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, id);
    window.history.pushState(window.history.state, "", url);
    pushed.current = true;
    notify();
  }, []);

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back(); // popstate fires -> subscribers re-read the URL
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete(PARAM);
      window.history.replaceState(window.history.state, "", url);
      notify();
    }
  }, []);

  return { peekId, open, close };
}
