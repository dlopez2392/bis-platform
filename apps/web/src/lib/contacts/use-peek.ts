"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

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
 *
 * Call this hook ONCE per page (the table) and thread peekId/open/close to
 * children via props — two live instances would keep divergent pushed
 * bookkeeping.
 */
export function usePeek() {
  const peekId = useSyncExternalStore(subscribe, readPeek, () => null);
  const pushed = useRef(false);

  useEffect(() => {
    // Any real history traversal invalidates "we pushed the current entry" —
    // without this reset, close() after a native Back pops the user's own
    // arrival entry instead of stripping the param in place.
    const onPop = () => { pushed.current = false; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, id);
    // `null`, never `window.history.state`: its `__NA` makes Next's patched pushState skip telling the router (next@16.2.11 app-router.js:252-263), so the next revalidation strips ?peek=.
    window.history.pushState(null, "", url);
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
      // `null` for the same reason as open() (next@16.2.11 app-router.js:268-279): the router must learn the stripped URL.
      window.history.replaceState(null, "", url);
      notify();
    }
  }, []);

  return { peekId, open, close };
}
